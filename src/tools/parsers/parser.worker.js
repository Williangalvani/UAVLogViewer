// Worker.js
// import MavlinkParser from 'mavlinkParser'
const mavparser = require('./mavlinkParser')
const DataflashParser = require('./JsDataflashParser/parser').default
const DjiParser = require('./djiParser').default
const McapParser = require('./mcapParser').default

console.log('[Parser Worker] Worker initialized and ready')

let parser
self.addEventListener('message', async function (event) {
    console.log('[Parser Worker] Received message:', {
        action: event.data?.action,
        hasFile: !!event.data?.file,
        isTlog: event.data?.isTlog,
        isDji: event.data?.isDji,
        isMcap: event.data?.isMcap
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
            await parser.processData(data)
        } else {
            console.log('[Parser Worker] Creating DataflashParser for dataflash file')
            parser = new DataflashParser(true)
            parser.processData(data, ['CMD', 'MSG', 'FILE', 'MODE', 'AHR2', 'ATT', 'GPS', 'POS',
                'XKQ1', 'XKQ', 'NKQ1', 'NKQ2', 'XKQ2', 'PARM', 'MSG', 'STAT', 'EV', 'XKF4', 'FNCE'])
        }

    } else if (event.data.action === 'loadType') {
        console.log('[Parser Worker] Loading message type:', event.data.type)
        if (!parser) {
            console.error('[Parser Worker] Parser not ready when trying to load type!')
            console.log('parser not ready')
        } else {
            parser.loadType(event.data.type.split('[')[0])
        }
    } else if (event.data.action === 'trimFile') {
        console.log('[Parser Worker] Trimming file to time:', event.data.time)
        parser.trimFile(event.data.time)
    } else {
        console.warn('[Parser Worker] Unknown action:', event.data.action)
    }
})
