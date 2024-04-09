<template>
    <div :id="getDivName()"
         v-bind:style="{width:  width + 'px', height: height + 'px', top: top + 'px', left: left + 'px' }">
        <div id="paneContent">
          <input ref="filepicker" @change="loadVideo" type="file" id="filePicker" accept="video/*">
          <br>
          <video ref="videoplayer" id="videoPlayer" width="640" controls>
              Your browser does not support the video tag.
          </video>
        </div>
    </div>
</template>

<script>
import { store } from '../Globals.js'
import { baseWidget } from './baseWidget.js'

export default {
    name: 'VideoViewer',
    mixins: [baseWidget],
    created () {
        this.$eventHub.$on('cesium-time-changed', this.setTime)
        this.$eventHub.$on('hoveredTime', this.setTime)
    },
    data () {
        return {
            name: 'VideoViewer',
            filter: '',
            state: store,
            width: 220,
            height: 215,
            left: 310,
            top: 0,
            forceRecompute: 0,
            cursorTime: 0
        }
    },
    methods: {
        setTime (time) {
            this.cursorTime = time
        },
        setup () {
        },
        loadVideo (event) {
            console.log('lloading')
            console.log(event)
            const file = event.target.files[0]
            const url = URL.createObjectURL(file)
            this.videoPlayer.src = url
            this.videoPlayer.load()
            console.log('loaded')
        }
    },
    computed: {
        videoPlayer () {
            return this.$refs.videoplayer
        },
        filepicker () {
            return this.$refs.filepicker
        }
    },
    watch: {
        filteredData: function (data) {
            const container = this.$el.querySelector('#paneContent')
            container.scrollTop = container.scrollHeight
        }
    },
    mounted () {
        this.setup()
    }
}
</script>

<style scoped>
   div #paneVideoViewer {
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

    div #paneVideoViewer::before {
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

     div #paneVideoViewer::after {
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
