

// --- Imports ---
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

// --- Express App Setup ---
const app = express();
const httpServer = http.createServer(app);

// --- Serve static files (the frontend) ---
// This is important for Nginx to correctly find the files
app.use(express.static(path.join(__dirname)));
app.use('/dist', express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for single-page application routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});


// --- Socket.IO Server ---
const io = new Server(httpServer, {
    path: '/socket.io/',
    cors: {
        origin: "*", 
    }
});

// --- Mediasoup Configuration ---
const mediasoupConfig = {
    worker: {
        rtcMinPort: 10000,
        rtcMaxPort: 10100,
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    },
    router: {
        mediaCodecs: [
            { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
            { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
        ]
    },
    webRtcTransport: {
        listenIps: [{
            ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || null
        }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    }
};

// --- Server State ---
let worker;
const rooms = new Map(); // roomName -> { router, peers: Map<peerId, Peer> }

// --- Mediasoup Worker Initialization ---
const createWorker = async () => {
    try {
        worker = await mediasoup.createWorker({
            logLevel: mediasoupConfig.worker.logLevel,
            logTags: mediasoupConfig.worker.logTags,
            rtcMinPort: mediasoupConfig.worker.rtcMinPort,
            rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
        });
        worker.on('died', () => {
            console.error('!!! mediasoup worker has died, exiting...');
            setTimeout(() => process.exit(1), 2000);
        });
        console.log(`-> Mediasoup worker created [pid:${worker.pid}]`);
        return worker;
    } catch (error) {
        console.error('!!! Failed to create mediasoup worker:', error);
        process.exit(1);
    }
};

const getOrCreateRoom = async (roomName) => {
    let room = rooms.get(roomName);
    if (!room) {
        console.log(`-> Creating room [name:${roomName}]`);
        const router = await worker.createRouter({ mediaCodecs: mediasoupConfig.router.mediaCodecs });
        room = { router, peers: new Map() };
        rooms.set(roomName, room);
    }
    return room;
};

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`-> Client connected [id:${socket.id}]`);
    let currentRoomName = null;

    const cleanupPeer = () => {
        if (!currentRoomName) return;
        const room = rooms.get(currentRoomName);
        if (room) {
            const peer = room.peers.get(socket.id);
            if (peer) {
                console.log(`-> Cleaning up for peer [id:${socket.id}]`);
                for (const producer of peer.producers.values()) {
                    producer.close();
                    // Inform other clients that this producer is gone
                    socket.to(currentRoomName).emit('producer-closed', { producerId: producer.id });
                }
            }
            room.peers.delete(socket.id);
            // If room is empty, close it
            if (room.peers.size === 0) {
                console.log(`-> Closing empty room [name:${currentRoomName}]`);
                room.router.close();
                rooms.delete(currentRoomName);
            }
        }
    };


    socket.on('joinRoom', async ({ roomName }, callback) => {
        try {
            console.log(`-> [${socket.id}] joining room [${roomName}]`);
            currentRoomName = roomName;
            const room = await getOrCreateRoom(roomName);
            socket.join(roomName);

            const peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
            room.peers.set(socket.id, peer);

            const existingProducers = [];
            for (const [peerId, otherPeer] of room.peers.entries()) {
                 if (peerId !== socket.id) {
                    for (const producer of otherPeer.producers.values()) {
                        existingProducers.push({ id: producer.id, appData: producer.appData, peerId: peerId });
                    }
                }
            }
            callback(existingProducers);
        } catch (error) {
            console.error(`!!! Error joining room [name:${roomName}]`, error);
        }
    });

    socket.on('getRouterRtpCapabilities', async ({ roomName }, callback) => {
        console.log(`-> [${socket.id}] requesting router RTP capabilities for room [${roomName}]`);
        const room = await getOrCreateRoom(roomName);
        if (room) {
             callback(room.router.rtpCapabilities);
        }
    });

    socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
        const room = rooms.get(currentRoomName);
        if (!room) return;
        console.log(`-> [${socket.id}] creating WebRTC transport (isSender: ${isSender})`);
        try {
            const transport = await room.router.createWebRtcTransport({
                ...mediasoupConfig.webRtcTransport,
                appData: { isSender } // Tag the transport as sender or receiver
            });
            room.peers.get(socket.id).transports.set(transport.id, transport);
            console.log(`-> [${socket.id}] transport created [id:${transport.id}]`);
            callback({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
        } catch (error) {
            console.error('!!! Failed to create WebRTC transport:', error);
        }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
        const peer = rooms.get(currentRoomName)?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) {
            console.error(`!!! [${socket.id}] connectTransport failed: transport not found [id:${transportId}]`);
            return;
        }
        console.log(`-> [${socket.id}] connecting transport [id:${transportId}]`);
        try {
            await transport.connect({ dtlsParameters });
            console.log(`-> [${socket.id}] transport connected [id:${transportId}]`);
            callback();
        } catch (error) {
            console.error(`!!! [${socket.id}] transport connect error on [id:${transportId}]:`, error);
        }
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
        const room = rooms.get(currentRoomName);
        const peer = room?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) {
             console.error(`!!! [${socket.id}] produce failed: transport not found [id:${transportId}]`);
            return;
        }
        console.log(`-> [${socket.id}] producing on transport [id:${transportId}], kind: ${kind}`);
        try {
            const producer = await transport.produce({ kind, rtpParameters, appData });
            peer.producers.set(producer.id, producer);
            console.log(`-> [${socket.id}] producer created [id:${producer.id}], broadcasting new-producer`);
            // Inform everyone else in the room about the new producer
            socket.to(currentRoomName).emit('new-producer', { producerId: producer.id, appData, peerId: socket.id });
            callback({ id: producer.id });
        } catch (error) {
            console.error('!!! Failed to create producer:', error);
        }
    });

    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        const room = rooms.get(currentRoomName);
        console.log(`-> [${socket.id}] attempting to consume producer [id:${producerId}]`);
        if (!room) {
             console.error(`!!! [${socket.id}] consume failed: room not found [${currentRoomName}]`);
             return callback({ error: `Room not found` });
        }
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
            console.error(`!!! [${socket.id}] cannot consume producer [id:${producerId}]`);
            return callback({ error: `Cannot consume` });
        }
        const peer = room.peers.get(socket.id);
        if (!peer) {
            console.error(`!!! [${socket.id}] consume failed: peer not found`);
            return callback({ error: `Peer not found` });
        }

        // Find the transport that is specifically for receiving media
        const recvTransport = Array.from(peer.transports.values()).find(t => t.appData.isSender === false);

        if (!recvTransport) {
            console.error(`!!! [${socket.id}] has no suitable transport for consumption`);
            return callback({ error: 'No suitable transport for consumption' });
        }
        console.log(`-> [${socket.id}] found recvTransport [id:${recvTransport.id}] for consumption`);
        try {
            const consumer = await recvTransport.consume({ producerId, rtpCapabilities, paused: true });
            peer.consumers.set(consumer.id, consumer);
            console.log(`-> [${socket.id}] consumer created [id:${consumer.id}] for producer [id:${producerId}]`);
            callback({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
        } catch (error) {
            console.error(`!!! [${socket.id}] failed to create consumer for producer [id:${producerId}]:`, error);
            callback({ error: error.message });
        }
    });

    socket.on('resume', async ({ consumerId }) => {
        const consumer = rooms.get(currentRoomName)?.peers.get(socket.id)?.consumers.get(consumerId);
        console.log(`-> [${socket.id}] resuming consumer [id:${consumerId}]`);
        if (consumer) {
            try {
                await consumer.resume();
                console.log(`-> [${socket.id}] consumer resumed [id:${consumerId}]`);
            } catch (error) {
                console.error(`!!! [${socket.id}] consumer resume error on [id:${consumerId}]:`, error);
            }
        } else {
             console.log(`-> [${socket.id}] could not find consumer to resume [id:${consumerId}]`);
        }
    });

    socket.on('chatMessage', ({ roomName, message }) => {
        // Broadcast to others in the room
        socket.to(roomName).emit('newChatMessage', { peerId: socket.id, message });
    });

    socket.on('disconnect', () => {
        console.log(`-> Client disconnected [id:${socket.id}]`);
        cleanupPeer();
    });
});

// --- Start Server ---
(async () => {
    await createWorker();

    if (!mediasoupConfig.webRtcTransport.listenIps[0].announcedIp) {
        console.warn('\n\n\n---');
        console.warn('!!! ВНИМАНИЕ: Переменная окружения MEDIASOUP_ANNOUNCED_IP не установлена.');
        console.warn('!!! Это может привести к проблемам с подключением, если сервер находится за NAT.');
        console.warn('!!! Установите ее в публичный IP-адрес вашего сервера для корректной работы.');
        console.warn('---\n\n\n');
    }

    const PORT = process.env.PORT || 3001;
    httpServer.listen(PORT, '127.0.0.1', () => { // Listen only on localhost
        console.log(`--- RuGram Call Server listening on http://127.0.0.1:${PORT} ---`);
    });
})();