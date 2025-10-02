import { McapStreamReader } from "@mcap/core";
import { decompress as decompressZstd } from "fzstd";

// Transform MCAP messages to the format expected by the viewer
function transformMcapData(messages, startTime) {
    console.log('[MCAP Parser] Starting data transformation', { 
        messageCount: messages.length, 
        startTime 
    });
    
    if (!messages || messages.length === 0) {
        console.warn('[MCAP Parser] No messages to transform');
        return {};
    }

    const transformedMessages = {};
    
    messages.forEach((msg, index) => {
        const { channelId, sequence, logTime, publishTime, data, schema } = msg;
        
        if (index % 1000 === 0) {
            console.log(`[MCAP Parser] Processing message ${index}/${messages.length}`, {
                channelId,
                sequence,
                logTime
            });
        }
        
        // Get the topic name from schema or use channel ID
        const topicName = schema?.name || `Channel_${channelId}`;
        
        if (!transformedMessages[topicName]) {
            console.log(`[MCAP Parser] Creating new message type: ${topicName}`);
            transformedMessages[topicName] = {
                time_boot_ms: []
            };
        }
        
        // Calculate timestamp relative to start time
        const timestamp = Number(logTime - startTime) / 1000000; // Convert nanoseconds to milliseconds
        transformedMessages[topicName].time_boot_ms.push(timestamp);
        
        // Parse the data based on schema
        try {
            if (data && typeof data === 'object') {
                Object.keys(data).forEach(key => {
                    if (!transformedMessages[topicName][key]) {
                        transformedMessages[topicName][key] = [];
                    }
                    transformedMessages[topicName][key].push(data[key]);
                });
            }
        } catch (error) {
            console.error('[MCAP Parser] Error parsing message data:', error, { topicName, sequence });
        }
    });
    
    console.log('[MCAP Parser] Transformation complete', {
        messageTypes: Object.keys(transformedMessages).length,
        messageTypesDetected: Object.keys(transformedMessages)
    });
    
    return transformedMessages;
}

// Extract message types from MCAP channels
function extractMessageTypes(channels) {
    console.log('[MCAP Parser] Extracting message types from channels', {
        channelCount: channels.length
    });
    
    const messageTypes = {};
    
    channels.forEach(channel => {
        const topicName = channel.schema?.name || channel.topic || `Channel_${channel.id}`;
        console.log(`[MCAP Parser] Processing channel: ${topicName}`, {
            channelId: channel.id,
            schemaId: channel.schemaId,
            messageEncoding: channel.messageEncoding
        });
        
        messageTypes[topicName] = {
            expressions: [],
            complexFields: []
        };
        
        // Try to extract field information from schema
        if (channel.schema && channel.schema.data) {
            try {
                // This will vary based on schema encoding (protobuf, json, etc.)
                console.log(`[MCAP Parser] Schema data available for ${topicName}`, {
                    encoding: channel.schema.encoding
                });
            } catch (error) {
                console.error(`[MCAP Parser] Error parsing schema for ${topicName}:`, error);
            }
        }
    });
    
    console.log('[MCAP Parser] Message type extraction complete', {
        typesExtracted: Object.keys(messageTypes).length
    });
    
    return messageTypes;
}

class McapParser {
    constructor() {
        console.log('[MCAP Parser] Initializing MCAP parser');
        this.messages = [];
        this.channels = [];
        this.schemas = [];
        this.metadata = {};
    }
    
    loadType(type) {
        console.log('[MCAP Parser] loadType called with:', type);
        console.warn('[MCAP Parser] loadType() is not fully implemented yet');
        // This would load specific message types on demand
        // Similar to how other parsers load specific message types
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
                    this.schemas.push(record);
                }
                
                if (record.type === 'Channel') {
                    console.log('[MCAP Parser] Found Channel record', {
                        id: record.id,
                        topic: record.topic,
                        schemaId: record.schemaId
                    });
                    this.channels.push(record);
                }
                
                if (record.type === 'Message') {
                    if (startTime === null) {
                        startTime = record.logTime;
                        console.log('[MCAP Parser] Set start time from first message', {
                            startTime: startTime.toString()
                        });
                    }
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
                totalChannels: this.channels.length,
                totalSchemas: this.schemas.length,
                metadataRecords: Object.keys(this.metadata).length
            });
            
            // Store the messages
            this.messages = messages;
            
            // Send metadata
            const metadata = {
                startTime: startTime ? Number(startTime) / 1000000 : Date.now(),
                messageCount: messages.length,
                channels: this.channels.length,
                schemas: this.schemas.length
            };
            console.log('[MCAP Parser] Sending metadata to main thread', metadata);
            self.postMessage({ metadata });
            
            // Extract and send available message types
            const messageTypes = extractMessageTypes(this.channels);
            console.log('[MCAP Parser] Sending available message types to main thread');
            self.postMessage({ availableMessages: messageTypes });
            
            // Transform and send messages
            console.log('[MCAP Parser] Transforming messages...');
            const transformedMessages = transformMcapData(messages, startTime || 0n);
            console.log('[MCAP Parser] Sending transformed messages to main thread');
            self.postMessage({ messages: transformedMessages });
            
            console.log('[MCAP Parser] Signaling completion');
            self.postMessage({ messagesDoneLoading: true });
            
            console.log('[MCAP Parser] Processing complete!');
            
        } catch (error) {
            console.error('[MCAP Parser] Error processing MCAP file:', error);
            console.error('[MCAP Parser] Error stack:', error.stack);
            throw error;
        }
    }
}

export default McapParser; 