// --- Imports ---
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const path = require('path');

// --- Express App Setup ---
const app = express();
const httpServer = http.createServer(app);

// Serve static files from the 'dist' directory and the root for index.html
app.use(express.static(__dirname));
app.use('/dist', express.static(path.join(__dirname, 'dist')));

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
            announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined
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
            console.error('mediasoup worker has died, exiting...');
            setTimeout(() => process.exit(1), 2000);
        });
        console.log(`-> mediasoup worker created [pid:${worker.pid}]`);
        return worker;
    } catch (error) {
        console.error('! Failed to create mediasoup worker:', error);
        process.exit(1);
    }
};

const getOrCreateRoom = async (roomName) => {
    let room = rooms.get(roomName);
    if (!room) {
        console.log(`-> creating room [name:${roomName}]`);
        const router = await worker.createRouter({ mediaCodecs: mediasoupConfig.router.mediaCodecs });
        room = { router, peers: new Map() };
        rooms.set(roomName, room);
    }
    return room;
};

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`-> client connected [id:${socket.id}]`);
    let currentRoomName = null;

    socket.on('joinRoom', async ({ roomName }, callback) => {
        try {
            currentRoomName = roomName;
            const room = await getOrCreateRoom(roomName);
            socket.join(roomName);

            const peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
            room.peers.set(socket.id, peer);

            const existingProducers = [];
            for (const otherPeer of room.peers.values()) {
                if (otherPeer !== peer) {
                    for (const producer of otherPeer.producers.values()) {
                        existingProducers.push({ id: producer.id, appData: producer.appData, peerId: Array.from(room.peers.entries()).find(([, p]) => p === otherPeer)[0] });
                    }
                }
            }
            callback(existingProducers);
        } catch (error) {
            console.error(`! Error joining room [name:${roomName}]`, error);
        }
    });

    socket.on('getRouterRtpCapabilities', (data, callback) => {
        const room = rooms.get(currentRoomName);
        if (room) callback(room.router.rtpCapabilities);
    });

    socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
        const room = rooms.get(currentRoomName);
        if (!room) return;
        try {
            const transport = await room.router.createWebRtcTransport(mediasoupConfig.webRtcTransport);
            room.peers.get(socket.id).transports.set(transport.id, transport);
            callback({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
        } catch (error) {
            console.error('! Failed to create WebRTC transport:', error);
        }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
        const peer = rooms.get(currentRoomName)?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) return;
        await transport.connect({ dtlsParameters });
        callback();
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
        const room = rooms.get(currentRoomName);
        const peer = room?.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) return;
        try {
            const producer = await transport.produce({ kind, rtpParameters, appData });
            peer.producers.set(producer.id, producer);
            socket.to(currentRoomName).emit('new-producer', { producerId: producer.id, appData, peerId: socket.id });
            callback({ id: producer.id });
        } catch (error) {
            console.error('! Failed to create producer:', error);
        }
    });

    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        const room = rooms.get(currentRoomName);
        if (!room || !room.router.canConsume({ producerId, rtpCapabilities })) {
            return callback({ error: `Cannot consume` });
        }
        const peer = room.peers.get(socket.id);
        const transport = Array.from(peer.transports.values()).find(t => ![...peer.producers.values()].some(p => p.transportId === t.id));

        if (!transport) return callback({ error: 'No suitable transport for consumption' });

        try {
            const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
            peer.consumers.set(consumer.id, consumer);
            callback({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
        } catch (error) {
            console.error('! Failed to create consumer:', error);
            callback({ error: error.message });
        }
    });

    socket.on('resume', async ({ consumerId }) => {
        const consumer = rooms.get(currentRoomName)?.peers.get(socket.id)?.consumers.get(consumerId);
        if (consumer) await consumer.resume();
    });

    socket.on('chatMessage', ({ roomName, message }) => {
        socket.to(roomName).emit('newChatMessage', { peerId: socket.id, message });
    });

    socket.on('disconnect', () => {
        console.log(`-> client disconnected [id:${socket.id}]`);
        const room = rooms.get(currentRoomName);
        if (room) {
            const peer = room.peers.get(socket.id);
            if (peer) {
                for (const producer of peer.producers.values()) {
                    producer.close();
                    socket.to(currentRoomName).emit('producer-closed', { producerId: producer.id });
                }
            }
            room.peers.delete(socket.id);
            if (room.peers.size === 0) {
                console.log(`-> closing empty room [name:${currentRoomName}]`);
                room.router.close();
                rooms.delete(currentRoomName);
            }
        }
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
    httpServer.listen(PORT, () => {
        console.log(`--- RuGram Call Server listening on port ${PORT} ---`);
    });
})();
