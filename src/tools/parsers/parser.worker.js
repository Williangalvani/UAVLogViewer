// Worker.js
// import MavlinkParser from 'mavlinkParser'
const mavparser = require('./mavlinkParser')
const DataflashParser = require('./JsDataflashParser/parser').default
const DjiParser = require('./djiParser').default
const McapParser = require('./mcapParser').default

console.log('[Parser Worker] Worker initialized and ready')

let parser
let messageCounter = 0

self.addEventListener('message', async function (event) {
    messageCounter++
    console.log(`[Parser Worker] <<<< Message #${messageCounter} received >>>>`)
    console.log('[Parser Worker] Message details:', {
        action: event.data?.action,
        hasFile: !!event.data?.file,
        isTlog: event.data?.isTlog,
        isDji: event.data?.isDji,
        isMcap: event.data?.isMcap,
        type: event.data?.type,
        timestamp: new Date().toISOString()
    })
    
    if (event.data === null) {
        console.error('[Parser Worker] Received null data in message!')
        console.log('got bad file message!')
    } else if (event.data.action === 'parse') {
        const data = event.data.file
        console.log('[Parser Worker] Starting file parsing', {
            dataSize: data.byteLength,
            isTlog: event.data.isTlog,
            isDji: event.data.isDji,
            isMcap: event.data.isMcap
        })
        
        if (event.data.isTlog) {
            console.log('[Parser Worker] Creating MavlinkParser for tlog file')
            parser = new mavparser.MavlinkParser()
            parser.processData(data)
        } else if (event.data.isDji) {
            console.log('[Parser Worker] Creating DjiParser for DJI file')
            parser = new DjiParser()
            await parser.processData(data)
        } else if (event.data.isMcap) {
            console.log('[Parser Worker] Creating McapParser for MCAP file')
            parser = new McapParser()
            console.log('[Parser Worker] McapParser created:', {
                hasLoadType: typeof parser.loadType === 'function',
                hasProcessData: typeof parser.processData === 'function',
                parserType: parser.constructor.name
            })
            await parser.processData(data)
            console.log('[Parser Worker] ✅ MCAP file processing complete, parser ready for loadType requests')
        } else {
            console.log('[Parser Worker] Creating DataflashParser for dataflash file')
            parser = new DataflashParser(true)
            parser.processData(data, ['CMD', 'MSG', 'FILE', 'MODE', 'AHR2', 'ATT', 'GPS', 'POS',
                'XKQ1', 'XKQ', 'NKQ1', 'NKQ2', 'XKQ2', 'PARM', 'MSG', 'STAT', 'EV', 'XKF4', 'FNCE'])
        }

    } else if (event.data.action === 'loadType') {
        console.log('[Parser Worker] ========================================')
        console.log('[Parser Worker] 📨 RECEIVED loadType request')
        console.log('[Parser Worker]    Raw type string:', event.data.type)
        console.log('[Parser Worker]    Parser exists:', !!parser)
        console.log('[Parser Worker]    Parser type:', parser?.constructor?.name)
        
        if (!parser) {
            console.error('[Parser Worker] ❌ ERROR: Parser not ready when trying to load type!')
            console.error('[Parser Worker]    This usually means the file hasn\'t been parsed yet')
            console.log('parser not ready')
        } else {
            const cleanType = event.data.type.split('[')[0]
            console.log('[Parser Worker]    Cleaned type:', cleanType)
            console.log('[Parser Worker] 🔄 Forwarding to parser.loadType()...')
            parser.loadType(cleanType)
            console.log('[Parser Worker] ✅ loadType() call completed')
        }
        console.log('[Parser Worker] ========================================')
    } else if (event.data.action === 'trimFile') {
        console.log('[Parser Worker] Trimming file to time:', event.data.time)
        if (!parser || !parser.trimFile) {
            console.warn('[Parser Worker] Parser does not support trimFile')
        } else {
            parser.trimFile(event.data.time)
        }
    } else {
        console.warn('[Parser Worker] Unknown action:', event.data.action)
    }
})
