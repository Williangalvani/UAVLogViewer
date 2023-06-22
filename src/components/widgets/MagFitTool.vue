<template>
    <div :id="getDivName()"
         v-bind:style='{width:  width + "px", height: height + "px", top: top + "px", left: left + "px" }'>
        <div id='paneContent'>
            <ul>
                <button v-on:click="fitWmm()">do it</button>
            </ul>
        </div>
    </div>
</template>

<script>
import { store } from '../Globals.js'
import { baseWidget } from './baseWidget'
import { Vector3 } from '../../mavextra/vector3'
import { Matrix3 } from '../../mavextra/matrix3'

function nelderMead (
    f, xStart, bounds, { alpha = 1, beta = 0.5, gamma = 2, maxIter = 100, epsilon = 1e-6 } = {}
) {
    const n = xStart.length
    const simplex = [xStart].concat([...Array(n)].map((_, i) => {
        const point = [...xStart]
        point[i] += point[i] !== 0 ? 0.05 * point[i] : 0.00025
        return point
    }))

    const boundedF = x => {
        for (let i = 0; i < n; i++) {
            if (x[i] < bounds[i][0] || x[i] > bounds[i][1]) {
                return f(x) + 1000
            }
        }
        return f(x)
    }

    for (let iter = 0; iter < maxIter; iter++) {
        const fValues = simplex.map(boundedF)
        const order = fValues.map((v, i) => [v, i]).sort(([a], [b]) => a - b)
        const bestIndex = order[0][1]
        const worstIndex = order[n][1]
        const secondWorstIndex = order[n - 1][1]

        const centroid = simplex.filter(
            (_, i) => i !== worstIndex
        ).reduce((a, b) => a.map((v, i) => v + b[i])).map(v => v / n)

        const xr = centroid.map((v, i) => (1 + alpha) * v - alpha * simplex[worstIndex][i])
        if (boundedF(xr) < boundedF(simplex[bestIndex])) {
            const xe = centroid.map((v, i) => (1 - gamma) * v + gamma * xr[i])
            simplex[worstIndex] = boundedF(xe) < boundedF(simplex[bestIndex]) ? xe : xr
        } else if (boundedF(xr) < boundedF(simplex[secondWorstIndex])) {
            simplex[worstIndex] = xr
        } else {
            const xc = centroid.map((v, i) => (1 + beta) * v - beta * simplex[worstIndex][i])
            if (boundedF(xc) < boundedF(simplex[worstIndex])) {
                simplex[worstIndex] = xc
            } else {
                for (let i = 0; i < simplex.length; i++) {
                    if (i !== bestIndex) {
                        simplex[i] = simplex[i].map((v, j) => simplex[bestIndex][j] + (v - simplex[bestIndex][j]) / 2)
                    }
                }
            }
        }

        if (Math.sqrt(order.map(
            ([v]) => (v - fValues[bestIndex]) ** 2
        ).reduce((a, b) => a + b) / (n + 1)) < epsilon) {
            break
        }
    }

    return simplex[0]
}

export default {
    name: 'MagFitTool',
    mixins: [baseWidget],
    data () {
        return {
            name: 'MagFitTool',
            state: store,
            width: 500,
            height: 215,
            left: 768,
            top: 100,
            forceRecompute: 0,
            numberOfPoints: 1000, // TODO: expose this to the user
            newParamFormat: true,
            forceScale: false,
            maxOffset: 500,
            maxScale: 1.2,
            minScale: 0.8,
            optimizingData: null
        }
    },
    methods: {
        setup () {
            this.loadRequiredData()
        },
        loadRequiredData () {
            // sends loadType messages for all of the following tyoes:
            // this includes both dataflash and telemetry logs
            const requiredTypes = ['PARAM', 'MAG', 'RAW_IMU', 'SCALED_IMU2', 'SCALED_IMU3', 'ATT', 'ATTITUDE']
            for (const type of requiredTypes) {
                this.$eventHub.$emit('loadType', type)
            }
        },
        removeOffsets (data, offsets) {
            console.log(data, offsets)
            /* remove all corrections to get raw sensor data */
            let correctionMatrix = new Matrix3(
                new Vector3(offsets.diag.x, offsets.offdiag.x, offsets.offdiag.y),
                new Vector3(offsets.offdiag.x, offsets.diag.y, offsets.offdiag.z),
                new Vector3(offsets.offdiag.y, offsets.offdiag.z, offsets.diag.z)
            )
            console.log(correctionMatrix)

            try {
                correctionMatrix = correctionMatrix.invert()
            } catch (error) {
                console.log(error)
                return false
            }

            const newData = {
                magX: [],
                magY: [],
                magZ: [],
                time: []
            }
            const length = Object.values(data)[0].length
            for (let index = 0; index < length; index++) {
                let field = new Vector3(data.xmag[index], data.ymag[index], data.zmag[index])
                // console.log(field)
                field = correctionMatrix.times(field)
                // console.log(field)
                field.multiply(1.0 / offsets.scaling)
                field.subtract(offsets.offsets)
                newData.magX.push(field.x)
                newData.magY.push(field.y)
                newData.magZ.push(field.z)
                newData.time.push(data.time_boot_ms[index])
            }
            return newData
        },
        paramName (name, index) {
            if (this.newParamFormat) {
                return `COMPASS${index}_${name}`
            }

            if (index === 1) {
                return `COMPASS_${name}`
            }
            return `COMPASS_${name}${index}`
        },
        getCompassParams (compassIndex) {
            const oldCorrections = {}
            if ('COMPASS_OFS_X' in this.parameters) {
                this.newParamFormat = false
            } else if ('COMPASS1_OFS_X' in this.parameters) {
                this.newParamFormat = true
            }
            oldCorrections.offsets = new Vector3(
                this.parameters[this.paramName('OFS', compassIndex) + '_X'] || 0.0,
                this.parameters[this.paramName('OFS', compassIndex) + '_Y'] || 0.0,
                this.parameters[this.paramName('OFS', compassIndex) + '_Z'] || 0.0
            )
            oldCorrections.diag = new Vector3(
                this.parameters[this.paramName('DIA', compassIndex) + '_X'] || 1.0,
                this.parameters[this.paramName('DIA', compassIndex) + '_Y'] || 1.0,
                this.parameters[this.paramName('DIA', compassIndex) + '_Z'] || 1.0
            )

            if (oldCorrections.diag.equals(new Vector3(0, 0, 0))) {
                oldCorrections.diag = new Vector3(1, 1, 1)
            }

            oldCorrections.offdiag = new Vector3(
                this.parameters[this.paramName('ODI', compassIndex) + '_X'] || 0.0,
                this.parameters[this.paramName('ODI', compassIndex) + '_Y'] || 0.0,
                this.parameters[this.paramName('ODI', compassIndex) + '_Z'] || 0.0
            )

            // oldCorrections.cmot_mode = this.parameters['COMPASS_MOTCT', CMOT_MODE_NONE)
            oldCorrections.cmot = new Vector3(
                this.parameters[this.paramName('MOT', compassIndex) + '_X'] || 0.0,
                this.parameters[this.paramName('MOT', compassIndex) + '_Y'] || 0.0,
                this.parameters[this.paramName('MOT', compassIndex) + '_Z'] || 0.0
            )

            oldCorrections.scaling = this.parameters[this.paramName('SCALE', compassIndex)] || null

            if (oldCorrections.scaling === null || oldCorrections.scaling < 0.1) {
                this.forceScale = false
                oldCorrections.scaling = 1.0
            } else {
                this.forceScale = true
            }
            return oldCorrections
        },

        getYaw (ATT, mag) {
            /* calculate heading from raw magnetometer and new offsets */

            // Go via a DCM matrix to match the APM calculation
            const dcmMatrix = (new Matrix3()).fromEuler(
                window.radians(ATT.roll),
                window.radians(ATT.pitch),
                window.radians(ATT.yaw)
            )
            const cosPitchSq = 1.0 - (dcmMatrix.c.x * dcmMatrix.c.x)
            const headY = mag.y * dcmMatrix.c.z - mag.z * dcmMatrix.c.y
            const headX = mag.x * cosPitchSq - dcmMatrix.c.x * (mag.y * dcmMatrix.c.y + mag.z * dcmMatrix.c.z)

            let yaw = window.degrees(Math.atan2(-headY, headX)) + this.declination
            if (yaw < 0) {
                yaw += 360
            }
            return yaw
        },
        expectedField (ATT, yaw) {
            // return expected magnetic field for attitude

            const roll = ATT.roll
            const pitch = ATT.pitch

            const rot = new Matrix3()
            rot.fromEuler(window.radians(roll), window.radians(pitch), window.radians(yaw))

            const field = rot.transposed().times(this.earthField)

            return field
        },
        wmmError (corrections) {
            console.log(corrections)
            const data = Object.assign({}, this.optimizingData)
            const corr = Object.assign({}, corrections)
            corr.offsets = new Vector3(corr[0], corr[1], corr[2])
            corr.scaling = corrections[3]

            corr.diag = new Vector3(1.0, 1.0, 1.0)
            corr.offdiag = new Vector3(0.0, 0.0, 0.0)

            let ret = 0
            for (let i = 0; i < data.time.length; i++) {
                const MAG = {
                    x: data.magX[i],
                    y: data.magY[i],
                    z: data.magZ[i]
                }
                const ATT = {
                    roll: data.roll[i],
                    pitch: data.pitch[i],
                    yaw: data.yaw[i]
                }
                const BAT = null
                const yaw = this.getYaw(ATT, MAG)
                const expected = this.expectedField(ATT, yaw)
                const observed = this.correct(MAG, BAT, corr)
                const error = expected.subtract(observed).length()
                ret += error
            }

            ret /= data.magX.length
            console.log(ret)
            return ret
        },

        correct (MAG, BAT, c) {
            // console.log('uncorrected mag: ', MAG)
            /* correct a mag sample, returning a Vector3 */
            let mag = new Vector3(MAG.x, MAG.y, MAG.z)
            // add the given offsets
            mag.add(c.offsets)
            // multiply by scale factor
            mag.multiply(c.scaling)
            // apply elliptical corrections
            const mat = new Matrix3(
                new Vector3(c.diag.x, c.offdiag.x, c.offdiag.y),
                new Vector3(c.offdiag.x, c.diag.y, c.offdiag.z),
                new Vector3(c.offdiag.y, c.offdiag.z, c.diag.z)
            )

            mag = mat.times(mag)
            // apply compassmot corrections
            // if (BAT !== null && BAT.Curr !== undefined && !isNaN(BAT.Curr)) {
            //     mag.add(c.cmot.multiply(BAT.Curr))
            // }
            // console.log('corrected mag: ', mag)
            return mag
        },
        fitWmm () {
            const data = this.compassDataAugmentedWithATT[0]
            this.optimizingData = data
            const oldCorrections = this.compassOffsets[0]
            const corr = Object.assign({}, oldCorrections)
            const optimizationParams = [corr.offsets.x, corr.offsets.y, corr.offsets.z, corr.scaling]

            const ofs = this.maxOffset
            const minScaleDelta = 0.00001
            const bounds = [
                [-ofs, ofs],
                [-ofs, ofs],
                [-ofs, ofs],
                [this.minScale, Math.max(this.minScale + minScaleDelta, this.maxScale)]
            ]
            console.log(bounds)

            this.optimizingData = data
            console.log('optimizing')
            // const result = numeric.uncmin(this.wmmError, optimizationParams, { bounds: bounds })
            const result = nelderMead(this.wmmError, optimizationParams, bounds)
            console.log('Optimization result: ', result)

            const c = Object.assign({}, oldCorrections)
            c.offsets = new Vector3(result[0], result[1], result[2])
            c.scaling = result[3]
            c.diag = new Vector3(1.0, 1.0, 1.0)
            c.offdiag = new Vector3(0.0, 0.0, 0.0)
            c.cmot = new Vector3(0.0, 0.0, 0.0)
            this.results = c

            return c
        }
    },
    computed: {
        position () {
            const pos = Object.values(this.state.trajectories)[0].trajectory[0]
            return {
                lon: pos[0],
                lat: pos[1]
            }
        },
        // next three come from mavextra.js
        intensity () {
            return window.interpolate_table(window.intensity_table, this.position.lat, this.position.lon)
        },
        declination () {
            return window.interpolate_table(window.declination_table, this.position.lat, this.position.lon)
        },
        inclination () {
            return window.interpolate_table(window.inclination_table, this.position.lat, this.position.lon)
        },
        earthField () {
            return new Vector3(this.declination, this.inclination, this.intensity)
        },
        compassData () {
            const data = []
            for (const message of ['RAW_IMU', 'SCALED_IMU2', 'SCALED_IMU3', 'MAG[0]', 'MAG[1]', 'MAG[2]']) {
                if (this.state.messages[message]) {
                    data.push(this.state.messages[message])
                }
            }
            return data
        },
        filteredCompassData () {
            // returns the compassData, but with the data filtered to only include the data that is used
            // that means we will only pass through the following fields:
            // TODO: add dataflash ones
            const wantedFields = ['time_boot_ms', 'xmag', 'ymag', 'zmag', 'MagX', 'MagY', 'MagZ']
            const filtered = []
            const nameMap = {
                xmag: 'xmag',
                ymag: 'ymag',
                zmag: 'zmag',
                MagX: 'xmag',
                MagY: 'ymag',
                MagZ: 'zmag',
                // eslint-disable-next-line camelcase
                time_boot_ms: 'time_boot_ms'
            }
            for (const message of this.compassData) {
                const filteredMessage = {}
                // for each key, value in message, filter it down:
                for (const [key, values] of Object.entries(message)) {
                    if (wantedFields.includes(key)) {
                        filteredMessage[nameMap[key]] = values
                    }
                }
                filtered.push(filteredMessage)
            }
            return filtered
        },
        sampledCompassData () {
            // returns this.compassData, but sampled down in a way that every array child of each message
            // has at most this.numberOfPoints
            const sampled = []
            for (const message of this.filteredCompassData) {
                const messageLength = Object.values(message)[0].length
                const sampleRate = Math.floor(messageLength / this.numberOfPoints) || 1
                const sampledMessage = {}
                // for each key, value in message, sample value down:
                for (const [key, values] of Object.entries(message)) {
                    const sampledValue = []
                    for (let i = 0; i < values.length; i += sampleRate) {
                        sampledValue.push(values[i])
                    }
                    sampledMessage[key] = sampledValue
                }
                sampled.push(sampledMessage)
            }
            return sampled
        },
        compassOffsets () {
            const offsets = []
            for (const compass in this.sampledCompassData) {
                console.log(compass)
                offsets.push(this.getCompassParams(parseFloat(compass) + 1))
            }
            return offsets
        },
        compassDataRemovedOffsets () {
            // returns this.compassData, but with the offsets removed
            const data = []
            for (const [compass, message] of Object.entries(this.sampledCompassData)) {
                data.push(this.removeOffsets(message, this.compassOffsets[compass]))
            }
            return data
        },
        attitudeMessages () {
            if ('ATT' in this.state.messages) {
                return this.state.messages.ATT
            }
            return this.state.messages.ATTITUDE
        },
        compassDataAugmentedWithATT () {
            // iterates on index of compassDataRemovedOffsets.time_boot_ms, finds the nearest ATT message
            // with the closes time_boot_ms, and adds that to the compassDataRemovedOffsets message
            return this.compassDataRemovedOffsets.map((message) => {
                const augmentedMessage = Object.assign({}, message)
                augmentedMessage.roll = []
                augmentedMessage.pitch = []
                augmentedMessage.yaw = []
                let attIndex = 0
                for (const time of message.time) {
                    while (this.attitudeMessages.time_boot_ms[attIndex] < time) {
                        attIndex++
                    }
                    augmentedMessage.roll.push(this.attitudeMessages.roll[attIndex])
                    augmentedMessage.pitch.push(this.attitudeMessages.pitch[attIndex])
                    augmentedMessage.yaw.push(this.attitudeMessages.yaw[attIndex])
                }
                return augmentedMessage
            })
        },
        parameters () {
            return this.state.params.values
        }
    }
}
</script>

<style scoped>
    div #paneMagFitTool {
        min-width: 220px;
        min-height: 150px;
        position: absolute;
        background: rgba(253, 254, 255, 0.856);
        color: #141924;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        z-index: 10000;
        box-shadow: 9px 9px 3px -6px rgba(26, 26, 26, 0.699);
        border-radius: 5px;
        user-select: none;
    }

    div #paneMagFitTool::before {
        content: '\25e2';
        color: #ffffff;
        background-color: rgb(38, 53, 71);
        position: absolute;
        bottom: -1px;
        right: 0;
        width: 17px;
        height: 21px;
        padding: 2px 3px;
        border-radius: 10px 0px 1px 0px;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        cursor: se-resize;
    }

     div #paneMagFitTool::after {
        content: '\2725';
        color: #2E3F54;
        position: absolute;
        top: 0;
        left: 0;
        width: 18px;
        height: 17px;
        margin-top: -3px;
        padding: 0px 2px;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        font-size: 17px;
         cursor: grab;
    }

    div#paneContent {
        height: 100%;
        overflow: auto;
        -webkit-user-select: none; /* Chrome all / Safari all */
        -moz-user-select: none; /* Firefox all */
        -ms-user-select: none; /* IE 10+ */
        user-select: none;
    }

    div#paneContent ul {
        list-style: none;
        line-height: 22px;
        padding: 16px;
        margin: 0;
    }

</style>
