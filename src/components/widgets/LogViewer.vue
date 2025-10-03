<template>
    <div :id="getDivName()"
         v-bind:style="{width: width + 'px', height: height + 'px', top: top + 'px', left: left + 'px' }">
        <div id="paneContent">
            <div class="header-row">
                <!-- Service Selection -->
                <div class="service-selector">
                    <label>Services:</label>
                    <div class="service-checkboxes">
                        <label v-for="service in availableServices" :key="service" class="service-checkbox">
                            <input
                                type="checkbox"
                                :value="service"
                                v-model="selectedServices"
                                @change="onServicesChange"
                                :checked="selectedServices.includes(service)"
                            >
                            <span>{{ getServiceDisplayName(service) }}</span>
                        </label>
                    </div>
                </div>

                <!-- Log Level Filter -->
                <div class="log-level-filter">
                    <label for="levelFilter">Level:</label>
                    <select id="levelFilter" v-model="selectedLevel" @change="onLevelChange">
                        <option value="">All levels</option>
                        <option value="DEBUG">DEBUG</option>
                        <option value="INFO">INFO</option>
                        <option value="WARN">WARN</option>
                        <option value="ERROR">ERROR</option>
                        <option value="FATAL">FATAL</option>
                    </select>
                </div>

                <!-- Search Filter -->
                <div class="search-filter">
                    <input
                        type="text"
                        v-model="searchFilter"
                        placeholder="Search messages..."
                        @input="onSearchChange"
                    />
                </div>

                <!-- Close button -->
                <span class="close-button" @click="close()">×</span>
            </div>

            <!-- Log Messages -->
            <div class="log-messages" v-if="selectedServices.length > 0">
                <div v-if="filteredLogs.length === 0" class="no-logs">
                    No log messages found
                </div>
                <div v-else>
                    <div
                        v-for="(log, index) in filteredLogs"
                        :key="index"
                        :ref="'logEntry' + index"
                        class="log-entry"
                        :class="[
                            getLogLevelClass(log.level),
                            { 'log-entry-highlighted': index === closestLogIndex }
                        ]"
                        @mouseenter="onLogHover(log.timestamp)"
                        @mouseleave="onLogLeave"
                    >
                        <span class="log-timestamp">{{ formatTimestamp(log.timestamp) }}</span>
                        <span class="log-service">{{ log.service }}</span>
                        <span class="log-level">{{ log.level }}</span>
                        <span class="log-name" v-if="log.name">{{ log.name }}</span>
                        <span class="log-message">{{ log.message }}</span>
                        <span class="log-meta" v-if="log.file || log.line">
                            <span v-if="log.file">{{ log.file }}</span><span v-if="log.line">:{{ log.line }}</span>
                        </span>
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
    name: 'LogViewer',
    mixins: [baseWidget],
    created () {
        this.$eventHub.$on('cesium-time-changed', this.setTime)
        this.$eventHub.$on('hoveredTime', this.setTime)
        this.$eventHub.$on('messages', this.onMessagesUpdated)
    },
    data () {
        return {
            name: 'LogViewer',
            state: store,
            width: 800,
            height: 400,
            left: 50,
            top: 50,
            selectedServices: [],
            selectedLevel: '',
            searchFilter: '',
            cursorTime: 0
        }
    },
    computed: {
        availableServices () {
            // Find all services that match the pattern "services/*/log"
            const services = []

            for (const messageType in this.state.messageTypes) {
                if (messageType.startsWith('services/') && messageType.endsWith('/log')) {
                    services.push(messageType)
                }
            }

            return services.sort()
        },
        processedLogs () {
            const allLogs = []

            // Process logs from all selected services
            for (const serviceName of this.selectedServices) {
                if (!this.state.messages[serviceName]) {
                    continue
                }

                const serviceData = this.state.messages[serviceName]
                const servicePath = this.getServiceDisplayName(serviceName)

                // Extract log fields
                const timestamps = serviceData.timestamp || serviceData.time_boot_ms || []
                const levels = serviceData.level || []
                const messages = serviceData.message || []
                const names = serviceData.name || []
                const files = serviceData.file || []
                const lines = serviceData.line || []

                // Create log entries for this service
                const maxLength = Math.max(timestamps.length, levels.length, messages.length)

                for (let i = 0; i < maxLength; i++) {
                    allLogs.push({
                        timestamp: timestamps[i] || 0,
                        service: servicePath,
                        level: this.getLevelName(levels[i] || 6),
                        message: messages[i] || '',
                        name: names[i] || '',
                        file: files[i] || '',
                        line: lines[i] || ''
                    })
                }
            }

            // Sort all logs by timestamp
            allLogs.sort((a, b) => {
                const timeA = this.getTimestampMillis(a.timestamp)
                const timeB = this.getTimestampMillis(b.timestamp)
                return timeA - timeB
            })

            return allLogs
        },
        filteredLogs () {
            return this.processedLogs
        },
        logStartTime () {
            // Get the earliest timestamp from all logs
            if (this.processedLogs.length === 0) {
                return 0
            }

            const firstLog = this.processedLogs[0]
            return this.getTimestampMillis(firstLog.timestamp)
        },
        closestLogIndex () {
            // Find the index of the single log entry closest to the current cursor time
            if (this.filteredLogs.length === 0 || this.cursorTime === 0) {
                return -1
            }

            let closestIndex = -1
            let minDiff = Infinity

            for (let i = 0; i < this.filteredLogs.length; i++) {
                const milliseconds = this.getTimestampMillis(this.filteredLogs[i].timestamp)
                const relativeTime = milliseconds - this.logStartTime
                const diff = Math.abs(relativeTime - this.cursorTime)

                if (diff < minDiff) {
                    minDiff = diff
                    closestIndex = i
                }
            }

            return closestIndex
        }
    },
    methods: {
        setTime (time) {
            this.cursorTime = time
        },
        getServiceDisplayName (servicePath) {
            // Extract meaningful name from "services/service-name/log"
            // Return the middle part (service-name)
            const parts = servicePath.split('/')
            if (parts.length >= 2 && parts[0] === 'services') {
                return parts[1] // Return the service name part
            }
            return servicePath // Fallback to full path if format is unexpected
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
        formatTimestamp (timestamp) {
            const milliseconds = this.getTimestampMillis(timestamp)
            if (milliseconds === 0) {
                return 'Invalid Date'
            }

            const date = new Date(milliseconds)
            if (isNaN(date.getTime())) {
                return 'Invalid Date'
            }

            // Format: YYYY-MM-DD HH:MM:SS.mmm
            const year = date.getFullYear()
            const month = String(date.getMonth() + 1).padStart(2, '0')
            const day = String(date.getDate()).padStart(2, '0')
            const hours = String(date.getHours()).padStart(2, '0')
            const minutes = String(date.getMinutes()).padStart(2, '0')
            const seconds = String(date.getSeconds()).padStart(2, '0')
            const ms = String(date.getMilliseconds()).padStart(3, '0')

            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`
        },
        getLevelName (level) {
            // Convert numeric log level to string
            // 0 = DEBUG, increases in severity from there
            if (typeof level === 'string') return level

            const levelMap = {
                0: 'TRACE',
                1: 'DEBUG',
                2: 'INFO',
                3: 'WARN',
                4: 'ERROR',
                5: 'FATAL'
            }
            return levelMap[level] || 'INFO'
        },
        getLogLevelClass (level) {
            const levelName = this.getLevelName(level)
            return `log-level-${levelName.toLowerCase()}`
        },
        onServicesChange () {
            // Request loading for all selected services
            for (const service of this.selectedServices) {
                if (service) {
                    this.$eventHub.$emit('loadType', service)
                }
            }
        },
        onLevelChange () {
            // Level change is handled by computed property
        },
        onSearchChange () {
            // Search change is handled by computed property
        },
        onMessagesUpdated () {
            // Force re-evaluation of computed properties when messages are updated
            // This is needed because Vue 2 can't detect new properties added to objects
            this.$forceUpdate()
        },
        onLogHover (timestamp) {
            // Emit hoveredTime event when hovering over a log entry
            // Emit time relative to log start
            const milliseconds = this.getTimestampMillis(timestamp)
            if (milliseconds > 0 && this.logStartTime > 0) {
                const relativeTime = milliseconds - this.logStartTime
                this.$eventHub.$emit('hoveredTime', relativeTime)
            }
        },
        onLogLeave () {
            // Could emit a signal to clear hover state if needed
            // For now, just let it stay at the last hovered time
        },
        scrollToHighlightedLog () {
            // Find the highlighted log entry and scroll it into view
            this.$nextTick(() => {
                const container = this.$el?.querySelector('.log-messages')
                if (!container || this.closestLogIndex === -1) return

                const logElement = this.$refs['logEntry' + this.closestLogIndex]
                if (logElement && logElement[0]) {
                    // Check if element is out of view
                    const containerRect = container.getBoundingClientRect()
                    const elementRect = logElement[0].getBoundingClientRect()

                    const isOutOfView = elementRect.top < containerRect.top ||
                                      elementRect.bottom > containerRect.bottom

                    if (isOutOfView) {
                        logElement[0].scrollIntoView({
                            behavior: 'smooth',
                            block: 'center'
                        })
                    }
                }
            })
        },
        setup () {
            // Load all available services on mount
            for (const service of this.availableServices) {
                this.$eventHub.$emit('loadType', service)
            }
        }
    },
    watch: {
        filteredLogs: function (logs) {
            // Auto-scroll to bottom when new logs arrive
            this.$nextTick(() => {
                const container = this.$el.querySelector('.log-messages')
                if (container) {
                    container.scrollTop = container.scrollHeight
                }
            })
        },
        cursorTime: function (newTime) {
            // Scroll to highlighted log when cursor time changes
            this.scrollToHighlightedLog()
        }
    }
}
</script>

<style scoped>
div #paneLogViewer {
    min-width: 600px;
    min-height: 400px;
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

div #paneLogViewer::before {
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

div #paneLogViewer::after {
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
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 8px;
}

.header-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding-right: 30px;
    position: relative;
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

.service-selector, .log-level-filter, .search-filter {
    display: flex;
    align-items: center;
    gap: 5px;
}

.service-selector {
    flex: 3;
    display: flex;
    align-items: center;
    gap: 8px;
}

.service-selector > label {
    font-weight: 600;
    font-size: 11px;
    white-space: nowrap;
    color: #b0b0b0;
}

.service-checkboxes {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.service-checkbox {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #d0d0d0;
    cursor: pointer;
}

.service-checkbox input[type="checkbox"] {
    cursor: pointer;
}

.service-checkbox span {
    user-select: none;
}

.log-level-filter {
    flex: 1;
}

.search-filter {
    flex: 2;
}

.log-level-filter label {
    font-weight: 600;
    font-size: 11px;
    white-space: nowrap;
    color: #b0b0b0;
}

.service-selector select, .log-level-filter select {
    flex: 1;
    padding: 3px 6px;
    border: 1px solid #555;
    border-radius: 3px;
    font-size: 11px;
    background: #2a2a2f;
    color: #f0f0f0;
}

.search-filter input {
    flex: 1;
    padding: 3px 6px;
    border: 1px solid #555;
    border-radius: 3px;
    font-size: 11px;
    background: #2a2a2f;
    color: #f0f0f0;
}

.search-filter input::placeholder {
    color: #777;
}

.log-messages {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #444;
    border-radius: 3px;
    background: #1a1a1f;
}

.no-logs {
    padding: 20px;
    text-align: center;
    color: #888;
    font-style: italic;
}

.log-entry {
    padding: 2px 8px;
    border-bottom: 1px solid #2a2a2f;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    display: flex;
    align-items: baseline;
    gap: 8px;
    line-height: 1.4;
}

.log-entry:hover {
    background: #252529;
}

.log-entry-highlighted {
    background: #2a3a4a !important;
    border-left: 3px solid #64b5f6;
    padding-left: 5px;
}

.log-entry:last-child {
    border-bottom: none;
}

.log-timestamp {
    color: #aaa;
    font-weight: 600;
    font-size: 10px;
    flex-shrink: 0;
    min-width: 180px;
}

.log-service {
    color: #9db4ff;
    font-weight: 600;
    font-size: 10px;
    flex-shrink: 0;
    min-width: 100px;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.log-level {
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 9px;
    text-transform: uppercase;
    flex-shrink: 0;
}

.log-level-debug {
    background: #1e3a5f;
    color: #64b5f6;
}

.log-level-info {
    background: #1e4620;
    color: #66bb6a;
}

.log-level-warn {
    background: #4a3a1e;
    color: #ffa726;
}

.log-level-error {
    background: #4a1e1e;
    color: #ef5350;
}

.log-level-fatal {
    background: #3d1e2e;
    color: #ec407a;
}

.log-name {
    color: #bbb;
    font-style: italic;
    font-size: 10px;
    flex-shrink: 0;
}

.log-message {
    flex: 1;
    word-break: break-word;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #e8e8e8;
}

.log-entry:hover .log-message {
    white-space: normal;
    overflow: visible;
}

.log-meta {
    font-size: 9px;
    color: #888;
    font-style: italic;
    flex-shrink: 0;
    margin-left: auto;
}
</style>
