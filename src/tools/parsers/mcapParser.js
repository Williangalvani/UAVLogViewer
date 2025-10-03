import { McapStreamReader } from "@mcap/core";
import { decompress as decompressZstd } from "fzstd";

// Helper function to clean mavlink topic names
// Converts "mavlink/1/1/ATTITUDE" -> "ATTITUDE"
// Converts "mavlink/255/240/COMMAND_LONG" -> "COMMAND_LONG"
function cleanTopicName(topicName) {
    // Remove leading slash if present
    let cleaned = topicName.replace(/^\//, '');

    // Remove mavlink/system_id/component_id/ prefix using regex
    // Matches: mavlink/<any_numbers>/<any_numbers>/
    const hadMavlinkPrefix = cleaned.startsWith('mavlink/');
    cleaned = cleaned.replace(/^mavlink\/\d+\/\d+\//, '');

    // Only log if we actually cleaned something
    if (hadMavlinkPrefix && cleaned !== topicName) {
        console.log(`[MCAP Parser] Cleaned topic name: "${topicName}" -> "${cleaned}"`);
    }

    return cleaned;
}

class McapParser {
    constructor() {
        console.log('[MCAP Parser] Initializing MCAP parser');
        this.allMessages = [];
        this.channels = new Map();
        this.schemas = new Map();
        
        this.metadata = {};
        this.messagesByChannel = new Map();
        this.startTime = null;
        this.loadedTypes = new Set();
    }

    loadType(type) {
        console.log('[MCAP Parser] ========================================');
        console.log('[MCAP Parser] 📥 REQUEST: Load message type:', type);
        console.log('[MCAP Parser] ========================================');

        if (this.loadedTypes.has(type)) {
            console.log('[MCAP Parser] ⚠️  Type already loaded:', type);
            return;
        }

        console.log('[MCAP Parser] 🔍 Searching for channels matching type:', type);
        console.log('[MCAP Parser] Total channels available:', this.channels.size);

        // Find channel(s) matching this topic name (comparing cleaned names)
        const matchingChannels = [];
        for (const [channelId, channel] of this.channels) {
            const cleanedTopic = cleanTopicName(channel.topic);
            if (cleanedTopic === type) {
                matchingChannels.push(channelId);
                console.log(`[MCAP Parser] ✅ MATCH FOUND - Channel ${channelId}:`);
                console.log(`[MCAP Parser]    Original topic: "${channel.topic}"`);
                console.log(`[MCAP Parser]    Cleaned topic:  "${cleanedTopic}"`);
                console.log(`[MCAP Parser]    Requested type: "${type}"`);
            }
        }

        if (matchingChannels.length === 0) {
            console.error('[MCAP Parser] ❌ ERROR: No channels found for requested type:', type);
            console.log('[MCAP Parser] Available topics (first 10):');
            let count = 0;
            for (const [id, channel] of this.channels) {
                if (count++ < 10) {
                    console.log(`[MCAP Parser]    - "${cleanTopicName(channel.topic)}" (from "${channel.topic}")`);
                }
            }
            return;
        }

        console.log('[MCAP Parser] 📊 Found', matchingChannels.length, 'matching channel(s)');

        // Get messages for these channels
        const messagesForType = {};
        matchingChannels.forEach(channelId => {
            const channel = this.channels.get(channelId);
            const channelMessages = this.messagesByChannel.get(channelId) || [];
            console.log(`[MCAP Parser] 📦 Processing channel ${channelId}: ${channelMessages.length} messages`);
            console.log(`[MCAP Parser]    Topic: "${channel.topic}"`);

            if (channelMessages.length > 0) {
                // Transform to the format expected by the viewer
                console.log(`[MCAP Parser] 🔄 Transforming ${channelMessages.length} messages for channel ${channelId}...`);
                const transformed = this.transformChannelMessages(channelMessages, channelId, type);

                // Verify the transformed data uses the correct key
                const transformedKeys = Object.keys(transformed);
                console.log(`[MCAP Parser] ✅ Transformed message keys:`, transformedKeys);

                if (transformedKeys.length > 0 && transformedKeys[0] === type) {
                    console.log(`[MCAP Parser] ✅ VERIFICATION PASSED: Output key "${transformedKeys[0]}" matches request "${type}"`);
                } else if (transformedKeys.length > 0) {
                    console.warn(`[MCAP Parser] ⚠️  WARNING: Output key "${transformedKeys[0]}" differs from request "${type}"`);
                }

                Object.assign(messagesForType, transformed);
            }
        });

        if (Object.keys(messagesForType).length > 0) {
            const outputKeys = Object.keys(messagesForType);
            console.log('[MCAP Parser] ✅ COMPLETE: Sending messages for type:', type);
            console.log('[MCAP Parser]    Output contains keys:', outputKeys);
            console.log('[MCAP Parser]    Sample data for first key:', {
                key: outputKeys[0],
                fieldCount: Object.keys(messagesForType[outputKeys[0]]).length,
                fields: Object.keys(messagesForType[outputKeys[0]]).slice(0, 5)
            });

            console.log('[MCAP Parser] 📤 POSTING MESSAGE to main thread...');
            // Send each message type individually like DataflashParser does
            Object.keys(messagesForType).forEach(messageType => {
                const messageList = messagesForType[messageType];
                console.log(`[MCAP Parser] 📤 Sending ${messageType} with ${Object.keys(messageList).length} fields`);
                self.postMessage({
                    messageType: messageType,
                    messageList: messageList
                });
            });
            console.log('[MCAP Parser] 📤 Messages posted successfully');

            this.loadedTypes.add(type);
            console.log('[MCAP Parser] ========================================');
        } else {
            console.error('[MCAP Parser] ❌ ERROR: No messages generated for type:', type);
            console.log('[MCAP Parser] ========================================');
        }
    }

    transformChannelMessages(messages, channelId, requestedType) {
        const channel = this.channels.get(channelId);
        const originalTopic = channel.topic.replace(/^\//, ''); // Remove leading slash
        const topicName = cleanTopicName(channel.topic);

        console.log(`[MCAP Parser] 🔧 transformChannelMessages:`);
        console.log(`[MCAP Parser]    Channel ID: ${channelId}`);
        console.log(`[MCAP Parser]    Original topic: "${channel.topic}"`);
        console.log(`[MCAP Parser]    Cleaned topic: "${topicName}"`);
        console.log(`[MCAP Parser]    Requested type: "${requestedType}"`);
        console.log(`[MCAP Parser]    Message count: ${messages.length}`);
        console.log(`[MCAP Parser]    Message encoding: ${channel.messageEncoding}`);

        if (requestedType && topicName !== requestedType) {
            console.warn(`[MCAP Parser] ⚠️  WARNING: Cleaned topic "${topicName}" doesn't match requested type "${requestedType}"`);
        }

        const result = {
            [topicName]: {
                time_boot_ms: []
            }
        };

        // Check if this is a mavlink JSON message (check original topic before cleaning)
        const isMavlinkJson = originalTopic.startsWith('mavlink/') && channel.messageEncoding === 'json';

        if (isMavlinkJson) {
            console.log(`[MCAP Parser] 🚁 Detected Mavlink JSON message - will extract from nested structure`);
        }

        messages.forEach((msg, index) => {
            // Calculate timestamp relative to start time
            const timestamp = Number(msg.logTime - this.startTime) / 1000000; // Convert nanoseconds to milliseconds
            result[topicName].time_boot_ms.push(timestamp);

            // Parse the data based on schema
            if (msg.data && typeof msg.data === 'object') {
                if (isMavlinkJson && msg.data.message && typeof msg.data.message === 'object') {
                    // For mavlink JSON messages, extract fields from the nested 'message' object
                    console.log(`[MCAP Parser] Extracting mavlink message fields for ${topicName}`);

                    // Add header timestamp if available
                    if (msg.data.header && msg.data.header.stamp) {
                        if (!result[topicName].header_stamp_sec) {
                            result[topicName].header_stamp_sec = [];
                            result[topicName].header_stamp_nanosec = [];
                        }
                        result[topicName].header_stamp_sec.push(msg.data.header.stamp.sec || 0);
                        result[topicName].header_stamp_nanosec.push(msg.data.header.stamp.nanosec || 0);
                    }

                    // Extract all fields from the message object
                    Object.keys(msg.data.message).forEach(key => {
                        if (!result[topicName][key]) {
                            result[topicName][key] = [];
                        }
                        result[topicName][key].push(msg.data.message[key]);
                    });
                } else {
                    // Default behavior for non-mavlink messages
                    Object.keys(msg.data).forEach(key => {
                        if (!result[topicName][key]) {
                            result[topicName][key] = [];
                        }
                        result[topicName][key].push(msg.data[key]);
                    });
                }
            }
        });

        // Log summary of what was generated
        const outputKey = Object.keys(result)[0];
        const fields = Object.keys(result[outputKey]);
        const messageCount = result[outputKey].time_boot_ms.length;

        console.log(`[MCAP Parser] ✅ Transform complete:`);
        console.log(`[MCAP Parser]    Output key: "${outputKey}"`);
        console.log(`[MCAP Parser]    Messages transformed: ${messageCount}`);
        console.log(`[MCAP Parser]    Fields extracted: ${fields.length}`);
        console.log(`[MCAP Parser]    Field names (first 10):`, fields.slice(0, 10));

        return result;
    }

    extractMessageTypesWithFields() {
        console.log('[MCAP Parser] Extracting message types with fields from first messages');

        const messageTypes = {};

        for (const [channelId, channel] of this.channels) {
            const originalTopic = channel.topic.replace(/^\//, '');
            const topicName = cleanTopicName(channel.topic);
            const messages = this.messagesByChannel.get(channelId);
            const schema = this.schemas.get(channel.schemaId);
            const isMavlinkJson = originalTopic.startsWith('mavlink/') && channel.messageEncoding === 'json';

            console.log(`[MCAP Parser] Processing channel: ${topicName}`, {
                channelId,
                schemaId: channel.schemaId,
                messageEncoding: channel.messageEncoding,
                schemaEncoding: schema?.encoding,
                messageCount: messages?.length || 0,
                isMavlinkJson
            });

            // Get field names from the first message
            const expressions = [];
            const complexFields = [];

            if (messages && messages.length > 0) {
                const firstMsg = messages[0];

                // Check if data is a raw byte array (Uint8Array or numeric keys)
                const isRawData = firstMsg.data instanceof Uint8Array ||
                                  (firstMsg.data && typeof firstMsg.data === 'object' &&
                                   Object.keys(firstMsg.data).every(k => !isNaN(k)));

                if (isRawData) {
                    console.warn(`[MCAP Parser] Channel ${topicName} contains raw binary data that needs decoding`);
                    console.log(`[MCAP Parser] Message encoding: ${channel.messageEncoding}, Schema encoding: ${schema?.encoding}`);

                    // For now, just indicate that the data exists but needs decoding
                    expressions.push('_raw_data');
                    complexFields.push({
                        name: '_raw_data',
                        units: 'bytes',
                        multiplier: 1
                    });
                } else if (isMavlinkJson && firstMsg.data?.message && typeof firstMsg.data.message === 'object') {
                    // For mavlink JSON messages, extract fields from the nested 'message' object
                    console.log(`[MCAP Parser] Extracting mavlink message fields from: ${topicName}`);

                    // Add header timestamp fields
                    if (firstMsg.data.header && firstMsg.data.header.stamp) {
                        expressions.push('header_stamp_sec', 'header_stamp_nanosec');
                        complexFields.push(
                            { name: 'header_stamp_sec', units: 's', multiplier: 1 },
                            { name: 'header_stamp_nanosec', units: 'ns', multiplier: 1 }
                        );
                    }

                    // Extract fields from message object
                    Object.keys(firstMsg.data.message).forEach(fieldName => {
                        expressions.push(fieldName);
                        complexFields.push({
                            name: fieldName,
                            units: "?",
                            multiplier: 1
                        });
                    });
                } else if (firstMsg.data && typeof firstMsg.data === 'object') {
                    // Data is already decoded (JSON schema or similar)
                    Object.keys(firstMsg.data).forEach(fieldName => {
                        expressions.push(fieldName);
                        complexFields.push({
                            name: fieldName,
                            units: "?",
                            multiplier: 1
                        });
                    });
                }
            }

            messageTypes[topicName] = {
                expressions,
                complexFields
            };
        }

        const typeNames = Object.keys(messageTypes);
        console.log('[MCAP Parser] ========================================');
        console.log('[MCAP Parser] 📋 AVAILABLE MESSAGE TYPES:');
        console.log(`[MCAP Parser]    Total types: ${typeNames.length}`);
        console.log('[MCAP Parser] ========================================');
        typeNames.forEach((name, idx) => {
            const type = messageTypes[name];
            console.log(`[MCAP Parser] ${idx + 1}. "${name}"`);
            console.log(`[MCAP Parser]    Fields: ${type.expressions.length}`);
            console.log(`[MCAP Parser]    Sample fields:`, type.expressions.slice(0, 5));
        });
        console.log('[MCAP Parser] ========================================');

        return messageTypes;
    }

    getFirstMessageOfEachType() {
        console.log('[MCAP Parser] Getting first message of each type');

        const firstMessages = {};

        for (const [channelId, messages] of this.messagesByChannel) {
            if (messages.length === 0) continue;

            const channel = this.channels.get(channelId);
            const originalTopic = channel.topic.replace(/^\//, '');
            const topicName = cleanTopicName(channel.topic);
            const isMavlinkJson = originalTopic.startsWith('mavlink/') && channel.messageEncoding === 'json';

            // Transform just the first message
            const firstMsg = messages[0];

            // Check if data is raw bytes
            const isRawData = firstMsg.data instanceof Uint8Array ||
                              (firstMsg.data && typeof firstMsg.data === 'object' &&
                               Object.keys(firstMsg.data).every(k => !isNaN(k)));

            if (isRawData) {
                // Don't send raw byte data as field values - it's not useful
                console.log(`[MCAP Parser] Skipping first message for ${topicName} - contains raw binary data`);
                firstMessages[topicName] = {
                    time_boot_ms: [Number(firstMsg.logTime - this.startTime) / 1000000],
                    _raw_data: [firstMsg.data instanceof Uint8Array ? firstMsg.data.length : Object.keys(firstMsg.data).length]
                };
            } else if (isMavlinkJson && firstMsg.data?.message && typeof firstMsg.data.message === 'object') {
                // For mavlink JSON messages, extract fields from the nested 'message' object
                console.log(`[MCAP Parser] Extracting first mavlink message for ${topicName}`);

                firstMessages[topicName] = {
                    time_boot_ms: [Number(firstMsg.logTime - this.startTime) / 1000000]
                };

                // Add header timestamp if available
                if (firstMsg.data.header && firstMsg.data.header.stamp) {
                    firstMessages[topicName].header_stamp_sec = [firstMsg.data.header.stamp.sec || 0];
                    firstMessages[topicName].header_stamp_nanosec = [firstMsg.data.header.stamp.nanosec || 0];
                }

                // Extract all fields from the message object
                Object.keys(firstMsg.data.message).forEach(key => {
                    firstMessages[topicName][key] = [firstMsg.data.message[key]];
                });
            } else {
                firstMessages[topicName] = {
                    time_boot_ms: [Number(firstMsg.logTime - this.startTime) / 1000000]
                };

                if (firstMsg.data && typeof firstMsg.data === 'object') {
                    Object.keys(firstMsg.data).forEach(key => {
                        firstMessages[topicName][key] = [firstMsg.data[key]];
                    });
                }
            }
        }

        console.log('[MCAP Parser] First messages extracted', {
            topicCount: Object.keys(firstMessages).length
        });

        return firstMessages;
    }

    async processData(data) {
        console.log('[MCAP Parser] Starting MCAP data processing', {
            dataSize: data.byteLength,
            dataType: data.constructor.name
        });

        try {
            const uint8Data = new Uint8Array(data);
            console.log('[MCAP Parser] Created Uint8Array', { size: uint8Data.length });

            // Configure decompression handlers for zstd
            const decompressHandlers = {
                zstd: (buffer, decompressedSize) => {
                    console.log('[MCAP Parser] Decompressing zstd chunk', {
                        compressedSize: buffer.length,
                        expectedDecompressedSize: decompressedSize.toString()
                    });
                    return decompressZstd(buffer);
                }
            };

            const reader = new McapStreamReader({ decompressHandlers });
            console.log('[MCAP Parser] Created McapStreamReader instance with zstd decompression');

            // Parse the MCAP file
            console.log('[MCAP Parser] Starting to parse MCAP file...');
            reader.append(uint8Data);

            let startTime = null;
            const messages = [];

            console.log('[MCAP Parser] Reading records from MCAP file...');
            let record;
            while ((record = reader.nextRecord())) {
                if (record.type === 'Header') {
                    console.log('[MCAP Parser] Found Header record', {
                        profile: record.profile,
                        library: record.library
                    });
                    this.metadata.header = record;
                }

                if (record.type === 'Schema') {
                    console.log('[MCAP Parser] Found Schema record', {
                        id: record.id,
                        name: record.name,
                        encoding: record.encoding
                    });
                    this.schemas.set(record.id, record);
                }

                if (record.type === 'Channel') {
                    console.log('[MCAP Parser] Found Channel record', {
                        id: record.id,
                        topic: record.topic,
                        schemaId: record.schemaId
                    });
                    this.channels.set(record.id, record);
                }

                if (record.type === 'Message') {
                    if (startTime === null) {
                        startTime = record.logTime;
                        this.startTime = startTime;
                        console.log('[MCAP Parser] Set start time from first message', {
                            startTime: startTime.toString()
                        });

                        // Log details about the first message to understand data structure
                        const channel = this.channels.get(record.channelId);
                        const isMavlink = channel?.topic?.startsWith('/mavlink/') || channel?.topic?.startsWith('mavlink/');
                        const hasMessageField = record.data && typeof record.data === 'object' && 'message' in record.data;

                        console.log('[MCAP Parser] First message details:', {
                            channelId: record.channelId,
                            topic: channel?.topic,
                            messageEncoding: channel?.messageEncoding,
                            dataType: record.data?.constructor?.name,
                            dataLength: record.data?.length || record.data?.byteLength,
                            isUint8Array: record.data instanceof Uint8Array,
                            dataKeys: record.data && typeof record.data === 'object' ? Object.keys(record.data).slice(0, 10) : 'N/A',
                            sampleData: record.data instanceof Uint8Array ? Array.from(record.data.slice(0, 20)) : 'N/A',
                            isMavlinkStructure: isMavlink && hasMessageField
                        });

                        if (isMavlink && hasMessageField && record.data.message) {
                            console.log('[MCAP Parser] Detected Mavlink message structure - fields will be extracted from message object:',
                                Object.keys(record.data.message).slice(0, 10));
                        }
                    }

                    // Try to decode JSON messages
                    const channel = this.channels.get(record.channelId);
                    if (channel && channel.messageEncoding === 'json' && record.data instanceof Uint8Array) {
                        try {
                            let jsonString = new TextDecoder().decode(record.data);

                            // Replace NaN values in JSON string before parsing
                            // This handles cases where NaN appears as literal values in the JSON
                            jsonString = jsonString.replace(/:\s*NaN\s*([,}])/g, ': 0$1');

                            record.data = JSON.parse(jsonString);
                            if (startTime === record.logTime) {
                                console.log('[MCAP Parser] Successfully decoded JSON message:', {
                                    channelId: record.channelId,
                                    topic: channel.topic,
                                    fields: Object.keys(record.data)
                                });
                            }
                        } catch (error) {
                            console.error('[MCAP Parser] Failed to decode JSON message:', error, {
                                channelId: record.channelId,
                                topic: channel.topic
                            });
                        }
                    }

                    // Store messages grouped by channel
                    if (!this.messagesByChannel.has(record.channelId)) {
                        this.messagesByChannel.set(record.channelId, []);
                    }
                    this.messagesByChannel.get(record.channelId).push(record);
                    messages.push(record);

                    if (messages.length % 5000 === 0) {
                        console.log(`[MCAP Parser] Loaded ${messages.length} messages...`);
                    }
                }

                if (record.type === 'Metadata') {
                    console.log('[MCAP Parser] Found Metadata record', {
                        name: record.name
                    });
                    this.metadata[record.name] = record;
                }
            }

            console.log('[MCAP Parser] File parsing complete', {
                totalMessages: messages.length,
                totalChannels: this.channels.size,
                totalSchemas: this.schemas.size,
                metadataRecords: Object.keys(this.metadata).length
            });

            // Log schema information for debugging
            const schemaInfo = [];
            for (const [id, schema] of this.schemas) {
                schemaInfo.push({
                    id,
                    name: schema.name,
                    encoding: schema.encoding
                });
            }
            console.log('[MCAP Parser] Schemas found:', schemaInfo);

            // Check if any channels have known encodings that need decoders
            const encodings = new Set();
            const unsupportedEncodings = new Set();
            for (const [id, channel] of this.channels) {
                encodings.add(channel.messageEncoding);
                // JSON encoding is supported, others are not yet
                if (channel.messageEncoding !== 'json' && channel.messageEncoding) {
                    unsupportedEncodings.add(channel.messageEncoding);
                }
            }
            console.log('[MCAP Parser] Message encodings in file:', Array.from(encodings));

            if (unsupportedEncodings.size > 0) {
                console.warn('[MCAP Parser] ⚠️ This MCAP file contains encoded messages that require schema-specific decoders.');
                console.warn('[MCAP Parser] Unsupported encodings:', Array.from(unsupportedEncodings));
                console.warn('[MCAP Parser] These messages will appear as raw binary data until decoders are implemented.');
            }

            if (encodings.has('json')) {
                console.log('[MCAP Parser] ✅ JSON-encoded messages will be decoded automatically');

                // Count mavlink JSON channels
                let mavlinkChannelCount = 0;
                for (const [id, channel] of this.channels) {
                    if (channel.topic.startsWith('mavlink/') && channel.messageEncoding === 'json') {
                        mavlinkChannelCount++;
                    }
                }

                if (mavlinkChannelCount > 0) {
                    console.log(`[MCAP Parser] 🚁 Detected ${mavlinkChannelCount} Mavlink JSON channels - fields will be extracted from message object`);
                }
            }

            // Send metadata
            const metadata = {
                startTime: startTime ? Number(startTime) / 1000000 : Date.now(),
                messageCount: messages.length,
                channels: this.channels.size,
                schemas: this.schemas.size
            };
            console.log('[MCAP Parser] Sending metadata to main thread', metadata);
            self.postMessage({ metadata });

            // Extract and send available message types with first message fields
            const messageTypes = this.extractMessageTypesWithFields();
            console.log('[MCAP Parser] Sending available message types to main thread');
            self.postMessage({ availableMessages: messageTypes });

            // DON'T send first messages - they make the viewer think data is loaded
            // Messages will be loaded on-demand via loadType() when actually needed
            console.log('[MCAP Parser] ⚠️  NOT sending initial messages - will load on demand only');

            console.log('[MCAP Parser] Signaling completion (messages will be loaded on demand)');
            self.postMessage({ messagesDoneLoading: true });

            console.log('[MCAP Parser] Processing complete! Messages ready for on-demand loading.');

        } catch (error) {
            console.error('[MCAP Parser] Error processing MCAP file:', error);
            console.error('[MCAP Parser] Error stack:', error.stack);
            throw error;
        }
    }
}

export default McapParser;