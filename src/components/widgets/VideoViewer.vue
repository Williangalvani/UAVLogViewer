<template>
    <div :id="getDivName()"
         v-bind:style="{width: width + 'px', height: height + 'px', top: top + 'px', left: left + 'px' }">
        <div id="paneContent">
            <div class="header-row">
                <div class="video-info">
                    <span class="info-label">Stream:</span>
                    <span class="info-value">{{ streamTopic }}</span>
                    <span class="info-label">Format:</span>
                    <span class="info-value">{{ videoFormat || 'Unknown' }}</span>
                    <span class="info-label">Frames:</span>
                    <span class="info-value">{{ frameCount }}</span>
                </div>
                <span class="close-button" @click="close()">×</span>
            </div>

            <div class="video-container">
                <canvas
                    ref="videoCanvas"
                    class="video-canvas"
                ></canvas>
                <div v-if="errorMessage" class="info-overlay">
                    <i class="fa fa-exclamation-triangle"></i>
                    <div class="info-content">
                        <h3>{{ errorMessage }}</h3>
                        <div class="video-stats" v-if="videoFormat">
                            <div><strong>Format:</strong> {{ videoFormat }}</div>
                            <div><strong>Frames:</strong> {{ frameCount }}</div>
                            <div><strong>Frame Size:</strong>
                                {{ videoFrames.length > 0 ? (videoFrames[0].data.length / 1024).toFixed(1) : 0 }} KB avg
                            </div>
                        </div>
                    </div>
                </div>
                <div v-if="loading" class="loading-overlay">
                    <i class="fa fa-spinner fa-spin"></i>
                    <p>Loading video...</p>
                </div>
                <div v-if="decodingStatus" class="decoding-status">
                    {{ decodingStatus }}
                </div>

                <!-- Video Controls -->
                <div v-if="!loading && !errorMessage && frameCount > 0" class="video-controls">
                    <div class="control-row">
                        <button @click="togglePlayback" class="play-button">
                            <i :class="isPlaying ? 'fa fa-pause' : 'fa fa-play'"></i>
                        </button>
                        <div class="time-display">
                            {{ formatTime(getCurrentFrameTime()) }} / {{ formatTime(getTotalDuration()) }}
                        </div>
                        <div class="frame-display">
                            Frame {{ currentFrameIndex + 1 }} / {{ frameCount }}
                        </div>
                    </div>
                    <div class="seeking-bar">
                        <input
                            type="range"
                            :min="0"
                            :max="frameCount - 1"
                            :value="currentFrameIndex"
                            @input="seekToFrame($event.target.value)"
                            @change="seekToFrame($event.target.value)"
                            class="seek-slider"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { store } from '../Globals.js'
import { baseWidget } from './baseWidget'

export default {
    name: 'VideoViewer',
    mixins: [baseWidget],
    created () {
        this.$eventHub.$on('cesium-time-changed', this.setTime)
        this.$eventHub.$on('hoveredTime', this.setTime)
        this.$eventHub.$on('messages', this.onMessagesUpdated)
    },
    data () {
        return {
            name: 'VideoViewer',
            state: store,
            width: 640,
            height: 480,
            left: 100,
            top: 100,
            streamTopic: 'video/UDPStream0/stream',
            videoFormat: null,
            frameCount: 0,
            currentTime: 0,
            videoFrames: [],
            decodedFrames: new Map(), // Map of timestamp -> VideoFrame (limited buffer)
            maxDecodedFrames: 10, // Keep only 10 frames in memory at once
            lastKeyFrameIndex: -1, // Track the last keyframe for seeking
            keyFrameIndices: [], // Array of all keyframe indices
            spsData: null, // Sequence Parameter Set
            ppsData: null, // Picture Parameter Set
            loading: true,
            errorMessage: null,
            videoDecoder: null,
            currentFrameIndex: 0,
            decodingStatus: null,
            canvasContext: null,
            isPlaying: false,
            playbackInterval: null,
            pendingDecodeResolve: null,
            pendingDecodeReject: null,
            pendingDecodeIndex: null
        }
    },
    mounted () {
        this.loadVideoStream()
    },
    beforeDestroy () {
        // Cleanup event listeners
        this.$eventHub.$off('cesium-time-changed', this.setTime)
        this.$eventHub.$off('hoveredTime', this.setTime)
        this.$eventHub.$off('messages', this.onMessagesUpdated)

        // Cleanup video resources
        this.cleanup()
    },
    methods: {
        setTime (time) {
            console.log('[VideoViewer] Time changed:', time)
            this.currentTime = time
            this.seekToTime(time)
        },
        loadVideoStream () {
            console.log('[VideoViewer] Loading video stream:', this.streamTopic)
            this.loading = true
            this.errorMessage = null

            // Request loading of the video topic
            this.$eventHub.$emit('loadType', this.streamTopic)

            // Wait a bit for the data to load
            setTimeout(() => {
                this.processVideoData()
            }, 1000)
        },
        onMessagesUpdated () {
            // Force re-evaluation when messages are updated
            console.log('[VideoViewer] Messages updated, reprocessing video data')
            this.processVideoData()
        },
        processVideoData () {
            const cleanedTopic = this.streamTopic.replace(/^\//, '')

            if (!this.state.messages[cleanedTopic]) {
                console.warn('[VideoViewer] Video stream not found:', cleanedTopic)
                console.log('[VideoViewer] Available messages:', Object.keys(this.state.messages))
                this.errorMessage = `Video stream "${cleanedTopic}" not found in log file`
                this.loading = false
                return
            }

            const videoData = this.state.messages[cleanedTopic]
            console.log('[VideoViewer] Video data loaded:', {
                topic: cleanedTopic,
                fieldCount: Object.keys(videoData).length,
                fields: Object.keys(videoData)
            })

            // Extract video frames
            this.extractVideoFrames(videoData)
        },
        extractVideoFrames (videoData) {
            console.log('[VideoViewer] Starting video frame extraction')
            console.log('[VideoViewer] Video data structure:', {
                hasData: !!videoData.data,
                isDataArray: Array.isArray(videoData.data),
                dataLength: videoData.data ? videoData.data.length : 0,
                availableFields: Object.keys(videoData)
            })

            if (!videoData.data || !Array.isArray(videoData.data)) {
                console.error('[VideoViewer] Invalid video data format:', videoData)
                this.errorMessage = 'Invalid video data format'
                this.loading = false
                return
            }

            this.videoFrames = []
            const timestamps = videoData.time_boot_ms || videoData.timestamp || []
            const frameIds = videoData.frame_id || []
            const formats = videoData.format || []
            const dataArray = videoData.data

            console.log('[VideoViewer] Frame extraction details:', {
                timestampsLength: timestamps.length,
                frameIdsLength: frameIds.length,
                formatsLength: formats.length,
                dataArrayLength: dataArray.length
            })

            // Detect video format from first frame
            if (formats.length > 0) {
                this.videoFormat = formats[0]
                console.log('[VideoViewer] Detected video format:', this.videoFormat)
            }

            let totalDataSize = 0
            for (let i = 0; i < dataArray.length; i++) {
                const frameData = dataArray[i]
                const frameSize = frameData ? frameData.length : 0
                totalDataSize += frameSize

                this.videoFrames.push({
                    timestamp: this.getTimestampMillis(timestamps[i]),
                    frameId: frameIds[i] || '',
                    format: formats[i] || this.videoFormat,
                    data: frameData
                })

                if (i < 5 || i % 100 === 0) { // Log first 5 frames and every 100th frame
                    console.log(`[VideoViewer] Frame ${i}:`, {
                        timestamp: this.getTimestampMillis(timestamps[i]),
                        frameId: frameIds[i] || 'none',
                        format: formats[i] || this.videoFormat,
                        dataSize: frameSize
                    })
                }
            }

            this.frameCount = this.videoFrames.length
            console.log(`[VideoViewer] Extracted ${this.frameCount} video frames`)
            console.log('[VideoViewer] Total data size:', (totalDataSize / 1024 / 1024).toFixed(2), 'MB')
            console.log('[VideoViewer] Average frame size:', (totalDataSize / this.frameCount / 1024).toFixed(2), 'KB')
            console.log('[VideoViewer] Format:', this.videoFormat)

            if (this.frameCount > 0) {
                this.initializeVideoDecoder()
            } else {
                console.error('[VideoViewer] No video frames found')
                this.errorMessage = 'No video frames found'
                this.loading = false
            }
        },
        getTimestampMillis (timestamp) {
            // Handle ROS time format (object with sec and nsec)
            if (timestamp && typeof timestamp === 'object' && 'sec' in timestamp) {
                const millis = timestamp.sec * 1000 + Math.floor(timestamp.nsec / 1000000)
                console.log('[VideoViewer] Converted ROS timestamp:', timestamp, '→', millis)
                return millis
            } else if (typeof timestamp === 'number') {
                // console.log('[VideoViewer] Using numeric timestamp:', timestamp)
                return timestamp
            }
            console.warn('[VideoViewer] Invalid timestamp format:', timestamp)
            return 0
        },
        async initializeVideoDecoder () {
            // Check WebCodecs API support
            console.log('[VideoViewer] Checking WebCodecs support...')
            console.log('[VideoViewer] window.VideoDecoder:', typeof window.VideoDecoder)
            console.log('[VideoViewer] window.EncodedVideoChunk:', typeof window.EncodedVideoChunk)
            console.log('[VideoViewer] User Agent:', navigator.userAgent)

            if (typeof window.VideoDecoder === 'undefined') {
                this.errorMessage = 'WebCodecs API not supported in this browser. '
                this.errorMessage += 'Please use Chrome 94+, Edge 94+, or Opera 80+. '
                this.errorMessage += 'Make sure you are not in a cross-origin iframe.'
                this.loading = false
                console.error('[VideoViewer] WebCodecs not supported')
                return
            }

            console.log('[VideoViewer] Initializing WebCodecs VideoDecoder')

            // Get canvas context
            const canvas = this.$refs.videoCanvas
            if (!canvas) {
                console.error('[VideoViewer] Canvas not found')
                return
            }
            this.canvasContext = canvas.getContext('2d')

            // Create VideoDecoder
            console.log('[VideoViewer] Creating VideoDecoder instance')
            // eslint-disable-next-line no-undef
            this.videoDecoder = new VideoDecoder({
                output: (frame) => {
                    console.log('[VideoViewer] Frame decoded successfully:', {
                        timestamp: frame.timestamp,
                        displayWidth: frame.displayWidth,
                        displayHeight: frame.displayHeight,
                        format: frame.format,
                        duration: frame.duration
                    })
                    this.onFrameDecoded(frame)
                },
                error: (error) => {
                    console.error('[VideoViewer] Decoder error:', error)
                    console.error('[VideoViewer] Decoder error details:', {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        decoderState: this.videoDecoder ? this.videoDecoder.state : 'unknown',
                        pendingFrameIndex: this.pendingDecodeIndex
                    })

                    // Reject pending decode promise if there is one
                    if (this.pendingDecodeReject) {
                        this.pendingDecodeReject(error)
                        this.pendingDecodeResolve = null
                        this.pendingDecodeReject = null
                        this.pendingDecodeIndex = null
                    }

                    this.errorMessage = `Decoder error: ${error.message}`
                }
            })

            // Step 1: Analyze the video stream structure FIRST
            console.log('[VideoViewer] Step 1: Analyzing video stream structure...')
            await this.extractVideoMetadata()
            await this.findKeyFrames()

            // Step 2: Check if we found any real IDR keyframes
            if (!this.keyFrameIndices || this.keyFrameIndices.length === 0) {
                console.error('[VideoViewer] ❌ FATAL: No IDR keyframes found in video stream!')
                console.error('[VideoViewer] This video stream cannot be decoded with WebCodecs')
                this.errorMessage = 'No IDR keyframes found - video stream is not compatible with WebCodecs decoder'
                this.loading = false
                return
            }

            console.log(`[VideoViewer] ✅ Stream analysis complete - found ${this.keyFrameIndices.length} IDR keyframes at indices:`, this.keyFrameIndices)

            // Step 3: Configure decoder for H.264 Annex B format (raw stream with start codes)
            const config = {
                codec: 'avc1.42E01E', // H.264 Baseline profile - try AVCC first
                optimizeForLatency: true
            }

            console.log('[VideoViewer] 🔧 Detected Annex B format stream (with start codes)')
            console.log('[VideoViewer] 🔧 For Annex B, SPS/PPS should be in-band, not in decoder config')

            // For Annex B streams, we should NOT use the description field
            // The SPS/PPS are in-band in the stream data
            console.log('[VideoViewer] Configuring for Annex B: NO description field, SPS/PPS in-band')

            console.log('[VideoViewer] Step 2: Configuring VideoDecoder with config:', config)
            try {
                this.videoDecoder.configure(config)
                console.log('[VideoViewer] VideoDecoder configured successfully')
                console.log('[VideoViewer] Decoder state:', this.videoDecoder.state)

                // Step 4: Start decoding from the first IDR keyframe
                await this.startDecodingFromKeyframes()
            } catch (error) {
                console.error('[VideoViewer] Failed to configure decoder:', error)
                console.error('[VideoViewer] Configuration error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    config: config
                })
                this.errorMessage = `Failed to configure decoder: ${error.message}`
                this.loading = false
            }
        },
        async extractVideoMetadata () {
            console.log('[VideoViewer] Extracting SPS/PPS metadata from video frames...')

            // Look through first few frames to find SPS/PPS data
            const maxFramesToCheck = Math.min(10, this.videoFrames.length)

            for (let i = 0; i < maxFramesToCheck && (!this.spsData || !this.ppsData); i++) {
                const frame = this.videoFrames[i]

                // Look for NAL units in the frame data
                for (let j = 0; j < frame.data.length - 4; j++) {
                    if ((frame.data[j] === 0x00 && frame.data[j + 1] === 0x00 &&
                         frame.data[j + 2] === 0x00 && frame.data[j + 3] === 0x01) ||
                        (frame.data[j] === 0x00 && frame.data[j + 1] === 0x00 &&
                         frame.data[j + 2] === 0x01)) {
                        const nalHeaderIndex = (frame.data[j + 2] === 0x01) ? j + 3 : j + 4
                        if (nalHeaderIndex < frame.data.length) {
                            const nalUnitType = frame.data[nalHeaderIndex] & 0x1F

                            if (nalUnitType === 7 || nalUnitType === 8) {
                                // Find the end of this NAL unit
                                const nalStart = j
                                let nalEnd = frame.data.length

                                for (let k = j + 4; k < frame.data.length - 3; k++) {
                                    if ((frame.data[k] === 0x00 && frame.data[k + 1] === 0x00 &&
                                         frame.data[k + 2] === 0x00 && frame.data[k + 3] === 0x01) ||
                                        (frame.data[k] === 0x00 && frame.data[k + 1] === 0x00 &&
                                         frame.data[k + 2] === 0x01)) {
                                        nalEnd = k
                                        break
                                    }
                                }

                                const nalData = frame.data.slice(nalStart, nalEnd)
                                if (nalUnitType === 7 && !this.spsData) {
                                    this.spsData = nalData
                                    console.log(`[VideoViewer] Extracted SPS data (${nalData.length} bytes)`)
                                } else if (nalUnitType === 8 && !this.ppsData) {
                                    this.ppsData = nalData
                                    console.log(`[VideoViewer] Extracted PPS data (${nalData.length} bytes)`)
                                }
                            }
                        }
                    }
                }
            }

            console.log('[VideoViewer] Metadata extraction complete:', {
                hasSPS: !!this.spsData,
                hasPPS: !!this.ppsData,
                spsSize: this.spsData ? this.spsData.length : 0,
                ppsSize: this.ppsData ? this.ppsData.length : 0
            })
        },
        createAVCDecoderConfig () {
            // Create AVC decoder configuration (AVCC format)
            console.log('[VideoViewer] Creating AVC config with SPS/PPS data:', {
                spsDataLength: this.spsData.length,
                ppsDataLength: this.ppsData.length,
                spsFirstBytes: Array.from(this.spsData.slice(0, 10))
                    .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
                ppsFirstBytes: Array.from(this.ppsData.slice(0, 10))
                    .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
            })

            // Find the actual SPS/PPS data (skip start codes)
            let spsStart = 0
            let ppsStart = 0

            // Skip start codes in SPS data
            if (this.spsData.length >= 4 &&
                this.spsData[0] === 0x00 && this.spsData[1] === 0x00 &&
                this.spsData[2] === 0x00 && this.spsData[3] === 0x01) {
                spsStart = 4
            } else if (this.spsData.length >= 3 &&
                       this.spsData[0] === 0x00 && this.spsData[1] === 0x00 &&
                       this.spsData[2] === 0x01) {
                spsStart = 3
            }

            // Skip start codes in PPS data
            if (this.ppsData.length >= 4 &&
                this.ppsData[0] === 0x00 && this.ppsData[1] === 0x00 &&
                this.ppsData[2] === 0x00 && this.ppsData[3] === 0x01) {
                ppsStart = 4
            } else if (this.ppsData.length >= 3 &&
                       this.ppsData[0] === 0x00 && this.ppsData[1] === 0x00 &&
                       this.ppsData[2] === 0x01) {
                ppsStart = 3
            }

            const spsLength = this.spsData.length - spsStart
            const ppsLength = this.ppsData.length - ppsStart

            // Calculate correct config size: 6 (header) + 2 (sps length) + sps + 1 (pps count) + 2 (pps length) + pps
            const configSize = 6 + 2 + spsLength + 1 + 2 + ppsLength
            const config = new Uint8Array(configSize)

            let offset = 0

            console.log('[VideoViewer] Building AVC config:', {
                spsStart: spsStart,
                ppsStart: ppsStart,
                spsLength: spsLength,
                ppsLength: ppsLength,
                totalConfigSize: configSize
            })

            // AVCC header (6 bytes)
            config[offset++] = 0x01 // configurationVersion

            // Get profile info from SPS (after start code)
            const spsHeaderIndex = spsStart
            if (spsHeaderIndex + 3 < this.spsData.length) {
                config[offset++] = this.spsData[spsHeaderIndex + 1] // AVCProfileIndication
                config[offset++] = this.spsData[spsHeaderIndex + 2] // profile_compatibility
                config[offset++] = this.spsData[spsHeaderIndex + 3] // AVCLevelIndication
            } else {
                // Fallback values
                config[offset++] = 0x42 // Baseline profile
                config[offset++] = 0x00 // profile_compatibility
                config[offset++] = 0x1E // Level 3.0
            }

            config[offset++] = 0xFF // lengthSizeMinusOne (4 bytes)
            config[offset++] = 0xE1 // numOfSequenceParameterSets (1)

            // SPS length and data
            config[offset++] = (spsLength >> 8) & 0xFF
            config[offset++] = spsLength & 0xFF

            // Copy SPS data (without start code)
            const spsData = this.spsData.slice(spsStart)
            config.set(spsData, offset)
            offset += spsLength

            // PPS count and data
            config[offset++] = 0x01 // numOfPictureParameterSets (1)
            config[offset++] = (ppsLength >> 8) & 0xFF
            config[offset++] = ppsLength & 0xFF

            // Copy PPS data (without start code)
            const ppsData = this.ppsData.slice(ppsStart)
            config.set(ppsData, offset)

            console.log('[VideoViewer] Created AVC decoder config:', {
                totalSize: config.length,
                spsLength: spsLength,
                ppsLength: ppsLength,
                finalOffset: offset + ppsLength,
                configBytes: Array.from(config.slice(0, Math.min(20, config.length)))
                    .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
            })

            return config
        },
        extractAnnexBFrameData (frameData) {
            console.log('[VideoViewer] 🔍 Processing Annex B frame data (keeping SPS/PPS in-band)...')

            const nalUnits = []
            let firstNonAudStart = -1
            // Parse all NAL units in the frame
            for (let i = 0; i < frameData.length - 4; i++) {
                // Look for NAL unit start code
                if ((frameData[i] === 0x00 && frameData[i + 1] === 0x00 &&
                     frameData[i + 2] === 0x00 && frameData[i + 3] === 0x01) ||
                    (frameData[i] === 0x00 && frameData[i + 1] === 0x00 &&
                     frameData[i + 2] === 0x01)) {
                    const nalHeaderIndex = (frameData[i + 2] === 0x01) ? i + 3 : i + 4
                    if (nalHeaderIndex < frameData.length) {
                        const nalType = frameData[nalHeaderIndex] & 0x1F
                        nalUnits.push({ type: nalType, position: i })

                        // For Annex B, we want to keep SPS/PPS/IDR together
                        // Skip only AUDs (type 9) at the beginning
                        if (nalType !== 9 && firstNonAudStart === -1) {
                            firstNonAudStart = i
                            console.log(`[VideoViewer] 🎯 Starting from NAL type ${nalType} at position ${i}`)
                        }
                    }
                }
            }

            console.log('[VideoViewer] Frame NAL units:', nalUnits.map(n => `${n.type}@${n.position}`).join(', '))

            if (firstNonAudStart !== -1) {
                // Extract from first non-AUD NAL unit (includes SPS/PPS/IDR for Annex B)
                const extractedData = frameData.slice(firstNonAudStart)
                const hasIDR = nalUnits.some(n => n.type === 5)
                const hasSPS = nalUnits.some(n => n.type === 7)
                const hasPPS = nalUnits.some(n => n.type === 8)
                console.log(`[VideoViewer] ✅ Extracted Annex B data: ${extractedData.length} bytes (was ${frameData.length})`)
                console.log(`[VideoViewer] 📋 Contains: ${hasSPS ? 'SPS ' : ''}${hasPPS ? 'PPS ' : ''}${hasIDR ? 'IDR' : 'P-slice'}`)
                return extractedData
            } else {
                console.log('[VideoViewer] ⚠️ No non-AUD NAL units found, returning original frame data')
                return frameData
            }
        },
        async recreateDecoder () {
            console.log('[VideoViewer] Recreating VideoDecoder')

            // Close existing decoder if it exists
            if (this.videoDecoder) {
                try {
                    this.videoDecoder.close()
                } catch (error) {
                    console.debug('[VideoViewer] Error closing old decoder:', error.message)
                }
            }

            // Create new VideoDecoder
            console.log('[VideoViewer] Creating new VideoDecoder instance')
            // eslint-disable-next-line no-undef
            this.videoDecoder = new VideoDecoder({
                output: (frame) => {
                    console.log('[VideoViewer] Frame decoded successfully:', {
                        timestamp: frame.timestamp,
                        displayWidth: frame.displayWidth,
                        displayHeight: frame.displayHeight,
                        format: frame.format,
                        duration: frame.duration
                    })
                    this.onFrameDecoded(frame)
                },
                error: (error) => {
                    console.error('[VideoViewer] Decoder error:', error)
                    console.error('[VideoViewer] Decoder error details:', {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        decoderState: this.videoDecoder ? this.videoDecoder.state : 'unknown',
                        pendingFrameIndex: this.pendingDecodeIndex
                    })

                    // Reject pending decode promise if there is one
                    if (this.pendingDecodeReject) {
                        this.pendingDecodeReject(error)
                        this.pendingDecodeResolve = null
                        this.pendingDecodeReject = null
                        this.pendingDecodeIndex = null
                    }

                    this.errorMessage = `Decoder error: ${error.message}`
                }
            })

            // Configure decoder for H.264
            const config = {
                codec: 'avc1.42E01E', // H.264 Baseline profile
                optimizeForLatency: true
            }

            // Add description field if we have SPS/PPS data
            if (this.spsData && this.ppsData) {
                console.log('[VideoViewer] Adding AVC decoder configuration with SPS/PPS')
                config.description = this.createAVCDecoderConfig()
            }

            console.log('[VideoViewer] Configuring new VideoDecoder')
            this.videoDecoder.configure(config)
            console.log('[VideoViewer] New VideoDecoder configured, state:', this.videoDecoder.state)
        },
        async startDecodingFromKeyframes () {
            console.log('[VideoViewer] Starting decoding from detected IDR keyframes...')

            // Try each detected IDR keyframe until one works
            let decodingSuccessful = false
            const maxKeyframesToTry = Math.min(3, this.keyFrameIndices.length) // Only try first 3 keyframes

            for (let i = 0; i < maxKeyframesToTry && !decodingSuccessful; i++) {
                const keyFrameIndex = this.keyFrameIndices[i]
                console.log(`[VideoViewer] 🎯 ATTEMPTING DECODE OF IDR KEYFRAME at index ${keyFrameIndex}`)

                try {
                    // Check if decoder is closed and recreate if needed
                    if (this.videoDecoder && this.videoDecoder.state === 'closed') {
                        console.log(`[VideoViewer] Decoder is closed, recreating for keyframe ${keyFrameIndex}`)
                        await this.recreateDecoder()
                    }

                    await this.decodeFrameAtIndex(keyFrameIndex)

                    // Check if decoding was successful by seeing if we have any decoded frames
                    if (this.decodedFrames.size > 0) {
                        console.log(`[VideoViewer] 🎉 SUCCESS! IDR keyframe at index ${keyFrameIndex} decoded successfully!`)
                        decodingSuccessful = true
                        this.loading = false // Clear loading spinner on successful decode
                    } else {
                        console.log(`[VideoViewer] ❌ IDR keyframe at index ${keyFrameIndex} failed to decode`)
                    }
                } catch (error) {
                    console.log(`[VideoViewer] Error with IDR keyframe at index ${keyFrameIndex}:`, error.message)
                }
            }

            if (!decodingSuccessful) {
                console.error('[VideoViewer] ❌ FATAL: All IDR keyframes failed to decode!')
                this.errorMessage = 'All IDR keyframes failed to decode - video stream may be corrupted or incompatible'
                this.loading = false
            }
        },
        async findKeyFrames () {
            console.log('[VideoViewer] Analyzing video structure to find keyframes...')

            let keyFrameFound = false
            let keyFrameCount = 0
            const keyFrameIndices = []

            // Limit keyframe search to first 100 frames for efficiency
            const maxFramesToSearch = Math.min(100, this.videoFrames.length)
            console.log(`[VideoViewer] Searching for keyframes in first ${maxFramesToSearch} frames`)

            for (let i = 0; i < maxFramesToSearch; i++) {
                const frame = this.videoFrames[i]

                // Analyze NAL unit structure more thoroughly - look for ALL NAL units in frame
                let nalUnitType = null
                let isKeyFrame = false
                const nalUnitsFound = []

                // Look for NAL units in the frame data
                for (let j = 0; j < frame.data.length - 4; j++) {
                    // Look for NAL unit start code (0x00 0x00 0x00 0x01 or 0x00 0x00 0x01)
                    if ((frame.data[j] === 0x00 && frame.data[j + 1] === 0x00 &&
                         frame.data[j + 2] === 0x00 && frame.data[j + 3] === 0x01) ||
                        (frame.data[j] === 0x00 && frame.data[j + 1] === 0x00 &&
                         frame.data[j + 2] === 0x01)) {
                        const nalHeaderIndex = (frame.data[j + 2] === 0x01) ? j + 3 : j + 4
                        if (nalHeaderIndex < frame.data.length) {
                            const currentNalType = frame.data[nalHeaderIndex] & 0x1F
                            nalUnitsFound.push(currentNalType)

                            // Check for actual keyframe types
                            // Type 5: IDR slice (true keyframe)
                            if (currentNalType === 5) {
                                isKeyFrame = true
                                nalUnitType = currentNalType
                                console.log(`[VideoViewer] ✅ FOUND REAL IDR KEYFRAME at frame ${i}, position ${j}`)
                            }

                            // FALLBACK: If no IDR slices exist, treat frames with SPS as potential keyframes
                            // This is a common issue with some video streams that lack proper IDR frames
                            if (currentNalType === 7) {
                                // Only mark as keyframe if we haven't found any IDR slices yet
                                // and this frame also contains other slice types
                                const hasSliceData = nalUnitsFound.some(type => type === 1 || type === 2)
                                if (hasSliceData) {
                                    isKeyFrame = true
                                    nalUnitType = currentNalType
                                    console.log(`[VideoViewer] Using SPS+slice frame as keyframe fallback frame ${i}`)
                                }
                            }

                            // Store SPS/PPS for decoder configuration but don't treat as keyframes
                            if (currentNalType === 7 || currentNalType === 8) {
                                // console.log(`[VideoViewer] Found ${currentNalType === 7 ? 'SPS' : 'PPS'} at frame ${i}`)

                                // Extract SPS/PPS data for decoder configuration
                                const nalStart = j
                                let nalEnd = frame.data.length

                                // Find the end of this NAL unit (next start code or end of data)
                                for (let k = j + 4; k < frame.data.length - 3; k++) {
                                    if ((frame.data[k] === 0x00 && frame.data[k + 1] === 0x00 &&
                                         frame.data[k + 2] === 0x00 && frame.data[k + 3] === 0x01) ||
                                        (frame.data[k] === 0x00 && frame.data[k + 1] === 0x00 &&
                                         frame.data[k + 2] === 0x01)) {
                                        nalEnd = k
                                        break
                                    }
                                }

                                const nalData = frame.data.slice(nalStart, nalEnd)
                                if (currentNalType === 7) {
                                    this.spsData = nalData
                                    // console.log(`[VideoViewer] Extracted SPS data (${nalData.length} bytes)`)
                                } else if (currentNalType === 8) {
                                    this.ppsData = nalData
                                    // console.log(`[VideoViewer] Extracted PPS data (${nalData.length} bytes)`)
                                }
                            }
                        }
                    }
                }

                // Log all NAL units found in this frame for debugging
                if (i < 5) { // Only log first 5 frames to avoid spam
                    console.log(`[VideoViewer] Frame ${i} NAL units:`, nalUnitsFound.map(type => {
                        const names = { 1: 'P-slice', 2: 'P-slice', 5: 'IDR', 6: 'SEI', 7: 'SPS', 8: 'PPS', 9: 'AUD' }
                        return `${type}(${names[type] || 'unknown'})`
                    }).join(', '))
                }

                // Force log for debugging - show what we actually found (only first 5 frames)
                if (i < 5) {
                    console.log(`[VideoViewer] Frame ${i} detailed analysis:`, {
                        nalUnitsFound: nalUnitsFound,
                        isKeyFrame: isKeyFrame,
                        frameSize: frame.data.length,
                        firstBytes: Array.from(frame.data.slice(0, 12))
                            .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
                    })
                }

                // If no proper NAL units found, try the original method as fallback
                if (nalUnitType === null && frame.data.length > 4) {
                    nalUnitType = frame.data[4] & 0x1F
                    isKeyFrame = nalUnitType === 5
                }

                // No fallback logic - only use real IDR keyframes

                if (isKeyFrame) {
                    keyFrameFound = true
                    keyFrameCount++
                    keyFrameIndices.push(i)
                    this.keyFrameIndices.push(i) // Store in component data
                    this.lastKeyFrameIndex = i
                    console.log(`[VideoViewer] Found keyframe at index ${i}, NAL unit type: ${nalUnitType}`)
                }
            }

            // No fallback - if no real IDR keyframes found, we can't decode this stream properly

            console.log('[VideoViewer] Keyframe analysis complete:', {
                totalFrames: this.frameCount,
                framesSearched: maxFramesToSearch,
                keyFramesFound: keyFrameCount,
                keyFrameIndices: keyFrameIndices,
                keyFrameFound: keyFrameFound
            })

            // Debug: Show which frames were detected as keyframes
            console.log('[VideoViewer] 🔍 Detected keyframes:', keyFrameIndices.map(idx => `Frame ${idx}`).join(', '))

            // Store keyframes in component data for later use
            this.keyFrameIndices = keyFrameIndices
        },
        async alternativeDecoding () {
            console.log('[VideoViewer] Trying alternative decoding strategy')

            // Strategy: Try to decode frames that contain both SPS and slice data
            // regardless of whether they're marked as keyframes

            await this.recreateDecoder()

            const maxFramesToTry = Math.min(20, this.videoFrames.length)
            console.log(`[VideoViewer] Trying first ${maxFramesToTry} frames with alternative strategy`)

            for (let i = 0; i < maxFramesToTry; i++) {
                const frame = this.videoFrames[i]

                // Analyze what NAL units this frame contains
                const nalUnitsFound = []
                for (let j = 0; j < frame.data.length - 4; j++) {
                    if ((frame.data[j] === 0x00 && frame.data[j + 1] === 0x00 &&
                         frame.data[j + 2] === 0x00 && frame.data[j + 3] === 0x01) ||
                        (frame.data[j] === 0x00 && frame.data[j + 1] === 0x00 &&
                         frame.data[j + 2] === 0x01)) {
                        const nalHeaderIndex = (frame.data[j + 2] === 0x01) ? j + 3 : j + 4
                        if (nalHeaderIndex < frame.data.length) {
                            const nalType = frame.data[nalHeaderIndex] & 0x1F
                            if (!nalUnitsFound.includes(nalType)) {
                                nalUnitsFound.push(nalType)
                            }
                        }
                    }
                }

                // Try frames that have slice data (type 1 or 2) - these might be decodable
                const hasSliceData = nalUnitsFound.includes(1) || nalUnitsFound.includes(2)
                // const hasSPS = nalUnitsFound.includes(7)
                // const hasPPS = nalUnitsFound.includes(8)

                if (hasSliceData) {
                    console.log(`[VideoViewer] Alternative: Try frame ${i} with NAL units:`, nalUnitsFound.map(type => {
                        const names = { 1: 'P-slice', 2: 'P-slice', 5: 'IDR', 6: 'SEI', 7: 'SPS', 8: 'PPS', 9: 'AUD' }
                        return `${type}(${names[type] || 'unknown'})`
                    }).join(', '))

                    try {
                        // Force as keyframe for first attempt
                        // eslint-disable-next-line no-undef
                        const chunk = new EncodedVideoChunk({
                            type: 'key',
                            timestamp: i * 33333,
                            data: frame.data
                        })

                        // Create decode promise
                        const decodePromise = new Promise((resolve, reject) => {
                            this.pendingDecodeResolve = resolve
                            this.pendingDecodeReject = reject
                            this.pendingDecodeIndex = i

                            setTimeout(() => {
                                if (this.pendingDecodeReject) {
                                    this.pendingDecodeReject(new Error('Alternative decode timeout'))
                                    this.pendingDecodeResolve = null
                                    this.pendingDecodeReject = null
                                    this.pendingDecodeIndex = null
                                }
                            }, 3000)
                        })

                        console.log(`[VideoViewer] Alternative: Submitting frame ${i} as keyframe`)
                        this.videoDecoder.decode(chunk)
                        await decodePromise

                        if (this.decodedFrames.size > 0) {
                            console.log(`[VideoViewer] Alternative decoding successful at frame ${i}!`)
                            return
                        }
                    } catch (error) {
                        console.log(`[VideoViewer] Alternative frame ${i} failed:`, error.message)

                        // Reset state
                        this.pendingDecodeResolve = null
                        this.pendingDecodeReject = null
                        this.pendingDecodeIndex = null

                        // Recreate decoder if it got closed
                        if (this.videoDecoder.state === 'closed') {
                            await this.recreateDecoder()
                        }
                    }
                }
            }

            console.log('[VideoViewer] Alternative decoding completed, falling back to original fallback')
            await this.fallbackDecoding()
        },
        async fallbackDecoding () {
            console.log('[VideoViewer] Starting fallback decoding approach')

            // Recreate decoder for fallback attempt
            await this.recreateDecoder()

            // Try to decode first 5 frames as keyframes to see if any work
            const maxFramesToTry = Math.min(5, this.videoFrames.length)

            for (let i = 0; i < maxFramesToTry; i++) {
                const frame = this.videoFrames[i]

                try {
                    console.log(`[VideoViewer] Fallback: Trying frame ${i} as keyframe`)

                    // Check decoder state before attempting decode
                    if (this.videoDecoder.state === 'closed') {
                        console.log(`[VideoViewer] Decoder closed, recreating for fallback frame ${i}`)
                        await this.recreateDecoder()
                    }

                    // eslint-disable-next-line no-undef
                    const chunk = new EncodedVideoChunk({
                        type: 'key', // Force as keyframe
                        timestamp: i * 33333,
                        data: frame.data
                    })

                    this.videoDecoder.decode(chunk)

                    // Wait a bit to see if it decodes
                    await new Promise(resolve => setTimeout(resolve, 100))

                    if (this.decodedFrames.size > 0) {
                        console.log(`[VideoViewer] Fallback successful! Frame ${i} decoded as keyframe`)

                        // Now try to decode a few more frames as delta frames
                        for (let j = i + 1; j < Math.min(i + 5, this.videoFrames.length); j++) {
                            try {
                                const deltaFrame = this.videoFrames[j]
                                // eslint-disable-next-line no-undef
                                const deltaChunk = new EncodedVideoChunk({
                                    type: 'delta',
                                    timestamp: j * 33333,
                                    data: deltaFrame.data
                                })
                                this.videoDecoder.decode(deltaChunk)
                            } catch (error) {
                                console.log(`[VideoViewer] Fallback delta frame ${j} failed:`, error.message)
                            }
                        }

                        await this.videoDecoder.flush()
                        break
                    }
                } catch (error) {
                    console.log(`[VideoViewer] Fallback frame ${i} failed:`, error.message)
                }
            }

            if (this.decodedFrames.size > 0) {
                console.log(`[VideoViewer] Fallback decoding successful! Decoded ${this.decodedFrames.size} frames`)
                this.displayFrameAtIndex(0)
            } else {
                console.error('[VideoViewer] Fallback decoding also failed')
                this.errorMessage = 'Unable to decode video frames. The video '
                this.errorMessage += 'format may not be supported or the data may be corrupted.'
            }
        },
        async decodeFrameAtIndex (targetIndex) {
            console.log(`[VideoViewer] Decoding frame at index ${targetIndex}`)

            // Check if frame is already in buffer
            if (this.decodedFrames.has(targetIndex)) {
                console.log(`[VideoViewer] Frame ${targetIndex} already in buffer`)
                this.displayFrameAtIndex(targetIndex)
                return
            }

            // Clean up old frames to manage memory
            this.cleanupOldFrames(targetIndex)

            // Find the closest keyframe before or at target index
            let startIndex = 0

            if (this.keyFrameIndices.length > 0) {
                // Find the best keyframe to start from
                let bestKeyFrameIndex = 0

                for (const keyFrameIndex of this.keyFrameIndices) {
                    if (keyFrameIndex <= targetIndex) {
                        bestKeyFrameIndex = keyFrameIndex
                    } else {
                        break // keyframes are in order, so we can stop here
                    }
                }

                startIndex = bestKeyFrameIndex
                console.log(`[VideoViewer] Using keyframe at index ${startIndex} to decode target ${targetIndex}`)
            } else {
                // No keyframes found, start from beginning (fallback behavior)
                startIndex = 0
                console.log('[VideoViewer] No keyframes available, starting from beginning')
            }

            console.log(`[VideoViewer] Decoding from index ${startIndex} to ${targetIndex}`)

            // Decode frames from keyframe to target
            for (let i = startIndex; i <= targetIndex; i++) {
                if (this.decodedFrames.has(i)) continue // Skip already decoded frames

                const frame = this.videoFrames[i]
                const isKeyFrame = (i === startIndex) || (i === 0)

                try {
                    // Analyze frame data before decoding
                    console.log(`[VideoViewer] Analyzing frame ${i} before decoding:`, {
                        frameSize: frame.data.length,
                        isKeyFrame: isKeyFrame,
                        firstBytes: Array
                            .from(frame.data.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
                    })

                    // For Annex B format, process frame data (keep SPS/PPS in-band, skip only AUDs)
                    let frameData = frame.data
                    if (isKeyFrame) { // Process keyframes for Annex B format
                        frameData = this.extractAnnexBFrameData(frame.data)
                        console.log(`[VideoViewer] 🔧 Annex B data: ${frameData.length} bytes (was ${frame.data.length})`)
                    }

                    // eslint-disable-next-line no-undef
                    const chunk = new EncodedVideoChunk({
                        type: isKeyFrame ? 'key' : 'delta',
                        timestamp: i * 33333,
                        data: frameData
                    })

                    // Create a promise to wait for this specific frame
                    const decodePromise = new Promise((resolve, reject) => {
                        this.pendingDecodeResolve = resolve
                        this.pendingDecodeReject = reject
                        this.pendingDecodeIndex = i

                        // Add timeout to prevent hanging
                        setTimeout(() => {
                            if (this.pendingDecodeReject) {
                                this.pendingDecodeReject(new Error('Decode timeout'))
                                this.pendingDecodeResolve = null
                                this.pendingDecodeReject = null
                                this.pendingDecodeIndex = null
                            }
                        }, 5000) // 5 second timeout
                    })

                    console.log(`[VideoViewer] Submitting frame ${i} to decoder`)
                    this.videoDecoder.decode(chunk)
                    await decodePromise // Wait for this frame to be decoded
                    console.log(`[VideoViewer] Frame ${i} decoded successfully`)
                } catch (error) {
                    console.error(`[VideoViewer] Error decoding frame ${i}:`, error)
                    console.error(`[VideoViewer] Frame ${i} details:`, {
                        frameSize: frame.data.length,
                        isKeyFrame: isKeyFrame,
                        errorName: error.name,
                        errorMessage: error.message
                    })

                    // Reset pending decode state on error
                    this.pendingDecodeResolve = null
                    this.pendingDecodeReject = null
                    this.pendingDecodeIndex = null

                    // Don't throw the error, just log it and continue
                }
            }

            // Display the target frame
            this.displayFrameAtIndex(targetIndex)
        },
        cleanupOldFrames (currentIndex) {
            // Keep only frames within a window around current index
            const keepRange = Math.floor(this.maxDecodedFrames / 2)
            const minKeep = Math.max(0, currentIndex - keepRange)
            const maxKeep = currentIndex + keepRange

            const framesToDelete = []
            for (const [index, frame] of this.decodedFrames.entries()) {
                if (index < minKeep || index > maxKeep) {
                    framesToDelete.push(index)
                    frame.close() // Free video frame memory
                }
            }

            framesToDelete.forEach(index => {
                this.decodedFrames.delete(index)
            })

            if (framesToDelete.length > 0) {
                console.log(`[VideoViewer] Cleaned up ${framesToDelete.length} old frames`)
                console.log(`keeping ${this.decodedFrames.size} frames in buffer`)
            }
        },
        onFrameDecoded (videoFrame) {
            // Store decoded frame by its index
            const index = this.pendingDecodeIndex || this.decodedFrames.size
            this.decodedFrames.set(index, videoFrame)

            console.log(`[VideoViewer] Frame decoded and stored at index ${index}:`, {
                displayWidth: videoFrame.displayWidth,
                displayHeight: videoFrame.displayHeight,
                format: videoFrame.format,
                timestamp: videoFrame.timestamp,
                duration: videoFrame.duration,
                totalDecodedFrames: this.decodedFrames.size
            })

            // Set canvas size to match video on first frame
            if (this.decodedFrames.size === 1) {
                const canvas = this.$refs.videoCanvas
                canvas.width = videoFrame.displayWidth
                canvas.height = videoFrame.displayHeight
                console.log('[VideoViewer] Canvas sized to', canvas.width, 'x', canvas.height)
                console.log('[VideoViewer] First frame decoded successfully, video dimensions established')
            }

            // Resolve pending decode promise
            if (this.pendingDecodeResolve) {
                this.pendingDecodeResolve()
                this.pendingDecodeResolve = null
                this.pendingDecodeReject = null
                this.pendingDecodeIndex = null
            }
        },
        displayFrameAtIndex (index) {
            const videoFrame = this.decodedFrames.get(index)
            if (!videoFrame || !this.canvasContext) {
                console.warn('[VideoViewer] Cannot display frame:', {
                    index: index,
                    hasVideoFrame: !!videoFrame,
                    hasCanvasContext: !!this.canvasContext
                })
                return
            }

            console.log(`[VideoViewer] Displaying frame at index ${index}`)
            const canvas = this.$refs.videoCanvas
            this.canvasContext.drawImage(videoFrame, 0, 0, canvas.width, canvas.height)
            this.currentFrameIndex = index
        },
        async seekToTime (time) {
            // Find the frame closest to the current time
            if (this.videoFrames.length === 0) {
                console.warn('[VideoViewer] Cannot seek to time:', {
                    time: time,
                    videoFramesLength: this.videoFrames.length
                })
                return
            }

            let closestIdx = 0
            let minDiff = Infinity

            for (let i = 0; i < this.videoFrames.length; i++) {
                const diff = Math.abs(this.videoFrames[i].timestamp - time)
                if (diff < minDiff) {
                    minDiff = diff
                    closestIdx = i
                }
            }

            console.log('[VideoViewer] Seeking to time:', {
                targetTime: time,
                closestFrameIndex: closestIdx,
                closestFrameTime: this.videoFrames[closestIdx].timestamp,
                timeDifference: minDiff
            })

            // Decode and display the closest frame
            await this.decodeFrameAtIndex(closestIdx)
        },
        cleanup () {
            // Stop playback
            this.stopPlayback()

            // Close and cleanup VideoDecoder
            if (this.videoDecoder) {
                try {
                    this.videoDecoder.close()
                } catch (error) {
                    console.error('[VideoViewer] Error closing decoder:', error)
                }
                this.videoDecoder = null
            }

            // Close all decoded VideoFrames to free memory
            for (const frame of this.decodedFrames.values()) {
                try {
                    frame.close()
                } catch (error) {
                    console.error('[VideoViewer] Error closing video frame:', error)
                }
            }
            this.decodedFrames.clear()
        },
        async seekToFrame (frameIndex) {
            const index = parseInt(frameIndex)
            console.log('[VideoViewer] Seeking to frame:', {
                requestedIndex: frameIndex,
                parsedIndex: index,
                frameCount: this.frameCount,
                hasDecodedFrame: this.decodedFrames.has(index)
            })

            if (index >= 0 && index < this.frameCount) {
                await this.decodeFrameAtIndex(index)

                // Update current time based on frame timestamp
                if (this.videoFrames[index]) {
                    this.currentTime = this.videoFrames[index].timestamp
                    console.log('[VideoViewer] Updated current time to:', this.currentTime)
                }
            } else {
                console.warn('[VideoViewer] Cannot seek to frame:', {
                    index: index,
                    validRange: `0-${this.frameCount - 1}`
                })
            }
        },
        togglePlayback () {
            console.log('[VideoViewer] Toggling playback, currently playing:', this.isPlaying)
            if (this.isPlaying) {
                this.stopPlayback()
            } else {
                this.startPlayback()
            }
        },
        startPlayback () {
            if (this.frameCount === 0) {
                console.warn('[VideoViewer] Cannot start playback:', {
                    frameCount: this.frameCount
                })
                return
            }

            console.log('[VideoViewer] Starting playback from frame:', this.currentFrameIndex)
            this.isPlaying = true
            this.playbackInterval = setInterval(async () => {
                if (this.currentFrameIndex < this.frameCount - 1) {
                    await this.seekToFrame(this.currentFrameIndex + 1)
                } else {
                    // Loop back to beginning or stop
                    console.log('[VideoViewer] Reached end of video, looping to beginning')
                    await this.seekToFrame(0)
                }
            }, 33) // ~30fps playback
        },
        stopPlayback () {
            console.log('[VideoViewer] Stopping playback')
            this.isPlaying = false
            if (this.playbackInterval) {
                clearInterval(this.playbackInterval)
                this.playbackInterval = null
            }
        },
        getCurrentFrameTime () {
            if (this.videoFrames.length > 0 && this.currentFrameIndex < this.videoFrames.length) {
                return this.videoFrames[this.currentFrameIndex].timestamp
            }
            return 0
        },
        getTotalDuration () {
            if (this.videoFrames.length > 0) {
                return this.videoFrames[this.videoFrames.length - 1].timestamp
            }
            return 0
        },
        formatTime (timestamp) {
            const seconds = Math.floor(timestamp / 1000)
            const minutes = Math.floor(seconds / 60)
            const remainingSeconds = seconds % 60
            const milliseconds = Math.floor((timestamp % 1000) / 10)

            let ret = `${minutes.toString().padStart(2, '0')}:`
            ret += `${remainingSeconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`
            return ret
        }
    }
}
</script>

<style scoped>
div #paneVideoViewer {
    min-width: 400px;
    min-height: 300px;
    position: absolute;
    background: rgba(30, 30, 35, 0.98);
    color: #f0f0f0;
    font-size: 12px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 9px 9px 3px -6px rgba(0, 0, 0, 0.8);
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
    content: '\25b6';
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
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 8px;
}

.header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding-right: 30px;
    position: relative;
}

.video-info {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
}

.info-label {
    font-weight: 600;
    color: #b0b0b0;
}

.info-value {
    color: #64b5f6;
}

.close-button {
    position: absolute;
    top: -3px;
    right: 0;
    font-size: 24px;
    font-weight: 300;
    cursor: pointer;
    color: #999;
    line-height: 1;
    padding: 0 5px;
}

.close-button:hover {
    color: #fff;
}

.video-container {
    flex: 1;
    position: relative;
    background: #000;
    border: 1px solid #444;
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
}

.video-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
}

.info-overlay,
.loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.9);
    color: #f0f0f0;
    padding: 20px;
    text-align: center;
}

.info-overlay {
    color: #64b5f6;
}

.info-overlay i {
    font-size: 48px;
    margin-bottom: 15px;
}

.info-content h3 {
    margin: 0 0 10px 0;
    font-size: 18px;
    color: #fff;
}

.info-content p {
    font-size: 13px;
    margin: 0 0 20px 0;
    color: #ccc;
    max-width: 500px;
}

.video-stats {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    text-align: left;
    background: rgba(255, 255, 255, 0.05);
    padding: 15px;
    border-radius: 5px;
}

.video-stats div {
    display: flex;
    justify-content: space-between;
    gap: 20px;
}

.video-stats strong {
    color: #64b5f6;
}

.loading-overlay i {
    font-size: 48px;
    margin-bottom: 15px;
}

.loading-overlay p {
    font-size: 14px;
    margin: 0;
}

.decoding-status {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: #64b5f6;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
}

.video-controls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
    padding: 20px 15px 15px;
    color: #f0f0f0;
}

.control-row {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 10px;
}

.play-button {
    background: #64b5f6;
    border: none;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.2s;
    color: #fff;
    font-size: 14px;
}

.play-button:hover {
    background: #42a5f5;
}

.play-button:active {
    background: #1e88e5;
}

.time-display,
.frame-display {
    font-size: 12px;
    font-weight: 500;
    color: #ccc;
    white-space: nowrap;
}

.frame-display {
    margin-left: auto;
}

.seeking-bar {
    width: 100%;
}

.seek-slider {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
}

.seek-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: #64b5f6;
    border-radius: 50%;
    cursor: pointer;
    transition: background-color 0.2s;
}

.seek-slider::-webkit-slider-thumb:hover {
    background: #42a5f5;
}

.seek-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #64b5f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: background-color 0.2s;
}

.seek-slider::-moz-range-thumb:hover {
    background: #42a5f5;
}

.seek-slider::-moz-range-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    border: none;
}
</style>
