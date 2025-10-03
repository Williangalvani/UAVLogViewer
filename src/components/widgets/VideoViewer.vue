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
            decodedFrames: new Map(), // Map of timestamp -> VideoFrame
            loading: true,
            errorMessage: null,
            videoDecoder: null,
            currentFrameIndex: 0,
            decodingStatus: null,
            canvasContext: null
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
            if (!videoData.data || !Array.isArray(videoData.data)) {
                this.errorMessage = 'Invalid video data format'
                this.loading = false
                return
            }

            this.videoFrames = []
            const timestamps = videoData.time_boot_ms || videoData.timestamp || []
            const frameIds = videoData.frame_id || []
            const formats = videoData.format || []
            const dataArray = videoData.data

            // Detect video format from first frame
            if (formats.length > 0) {
                this.videoFormat = formats[0]
            }

            for (let i = 0; i < dataArray.length; i++) {
                this.videoFrames.push({
                    timestamp: this.getTimestampMillis(timestamps[i]),
                    frameId: frameIds[i] || '',
                    format: formats[i] || this.videoFormat,
                    data: dataArray[i]
                })
            }

            this.frameCount = this.videoFrames.length
            console.log(`[VideoViewer] Extracted ${this.frameCount} video frames`)
            console.log('[VideoViewer] Format:', this.videoFormat)

            if (this.frameCount > 0) {
                this.initializeVideoDecoder()
            } else {
                this.errorMessage = 'No video frames found'
                this.loading = false
            }
        },
        getTimestampMillis (timestamp) {
            // Handle ROS time format (object with sec and nsec)
            if (timestamp && typeof timestamp === 'object' && 'sec' in timestamp) {
                return timestamp.sec * 1000 + Math.floor(timestamp.nsec / 1000000)
            } else if (typeof timestamp === 'number') {
                return timestamp
            }
            return 0
        },
        initializeVideoDecoder () {
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
            // eslint-disable-next-line no-undef
            this.videoDecoder = new VideoDecoder({
                output: (frame) => {
                    this.onFrameDecoded(frame)
                },
                error: (error) => {
                    console.error('[VideoViewer] Decoder error:', error)
                    this.errorMessage = `Decoder error: ${error.message}`
                }
            })

            // Configure decoder for H.264
            const config = {
                codec: 'avc1.42E01E', // H.264 Baseline profile
                optimizeForLatency: true
            }

            try {
                this.videoDecoder.configure(config)
                console.log('[VideoViewer] VideoDecoder configured')
                this.decodeAllFrames()
            } catch (error) {
                console.error('[VideoViewer] Failed to configure decoder:', error)
                this.errorMessage = `Failed to configure decoder: ${error.message}`
                this.loading = false
            }
        },
        async decodeAllFrames () {
            console.log('[VideoViewer] Starting to decode all frames...')
            this.decodingStatus = `Decoding 0/${this.frameCount} frames...`

            let keyFrameFound = false
            let decodedCount = 0

            for (let i = 0; i < this.videoFrames.length; i++) {
                const frame = this.videoFrames[i]

                // Check if this is a keyframe (IDR frame) by looking at NAL unit type
                const nalUnitType = frame.data[4] & 0x1F
                const isKeyFrame = nalUnitType === 5 // IDR slice

                if (isKeyFrame) {
                    keyFrameFound = true
                }

                // Only decode after we've found a keyframe
                if (!keyFrameFound) {
                    continue
                }

                try {
                    // eslint-disable-next-line no-undef
                    const chunk = new EncodedVideoChunk({
                        type: isKeyFrame ? 'key' : 'delta',
                        timestamp: i * 33333, // Approximate 30fps in microseconds
                        data: frame.data
                    })

                    this.videoDecoder.decode(chunk)
                    decodedCount++

                    if (decodedCount % 100 === 0) {
                        this.decodingStatus = `Decoding ${decodedCount}/${this.frameCount} frames...`
                        await new Promise(resolve => setTimeout(resolve, 0)) // Allow UI update
                    }
                } catch (error) {
                    console.error(`[VideoViewer] Error decoding frame ${i}:`, error)
                }
            }

            // Wait for all frames to be decoded
            await this.videoDecoder.flush()
            console.log('[VideoViewer] All frames decoded')

            this.loading = false
            this.decodingStatus = null

            // Display first frame
            if (this.decodedFrames.size > 0) {
                this.displayFrameAtIndex(0)
            }
        },
        onFrameDecoded (videoFrame) {
            // Store decoded frame by its index
            const index = this.decodedFrames.size
            this.decodedFrames.set(index, videoFrame)

            // Set canvas size to match video on first frame
            if (this.decodedFrames.size === 1) {
                const canvas = this.$refs.videoCanvas
                canvas.width = videoFrame.displayWidth
                canvas.height = videoFrame.displayHeight
                console.log('[VideoViewer] Canvas sized to', canvas.width, 'x', canvas.height)
            }
        },
        displayFrameAtIndex (index) {
            const videoFrame = this.decodedFrames.get(index)
            if (!videoFrame || !this.canvasContext) {
                return
            }

            const canvas = this.$refs.videoCanvas
            this.canvasContext.drawImage(videoFrame, 0, 0, canvas.width, canvas.height)
            this.currentFrameIndex = index
        },
        seekToTime (time) {
            // Find the frame closest to the current time
            if (this.videoFrames.length === 0 || this.decodedFrames.size === 0) return

            let closestIdx = 0
            let minDiff = Infinity

            for (let i = 0; i < this.videoFrames.length; i++) {
                const diff = Math.abs(this.videoFrames[i].timestamp - time)
                if (diff < minDiff) {
                    minDiff = diff
                    closestIdx = i
                }
            }

            // Display the closest decoded frame
            this.displayFrameAtIndex(closestIdx)
        },
        cleanup () {
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
</style>
