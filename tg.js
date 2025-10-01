// RuGram Media Server v3 (стабильная версия)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = 3001;
const rooms = {}; // { roomName: { router, peers: Map<socketId, peer> } }
let worker;

const createWorker = async () => {
    const worker = await mediasoup.createWorker({
        logLevel: 'warn',
    });

    worker.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds...');
        setTimeout(() => process.exit(1), 2000);
    });
    return worker;
};

const mediaCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
];

(async () => {
    worker = await createWorker();
})();

const createRoom = async (roomName) => {
    if (rooms[roomName]) {
        return rooms[roomName];
    }
    const router = await worker.createRouter({ mediaCodecs });
    rooms[roomName] = { router, peers: new Map() };
    return rooms[roomName];
};

io.on('connection', (socket) => {
    let roomName;

    socket.on('getRouterRtpCapabilities', async (data, callback) => {
        roomName = data.roomName;
        const room = await createRoom(roomName);
        callback(room.router.rtpCapabilities);
    });

    socket.on('joinRoom', (data, callback) => {
        const room = rooms[roomName];
        if (!room) return;
        
        const existingProducers = [];
        room.peers.forEach(peer => {
            peer.producers.forEach(producer => {
                existingProducers.push({ id: producer.id });
            });
        });
        
        const peer = {
            transports: new Map(),
            producers: new Map(),
            consumers: new Map(),
        };
        room.peers.set(socket.id, peer);

        callback(existingProducers);
    });

    socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
        const room = rooms[roomName];
        if (!room) return;
        
        const transport = await room.router.createWebRtcTransport({
            listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        });
        
        const peer = room.peers.get(socket.id);
        peer.transports.set(transport.id, transport);

        callback({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        });
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
        const room = rooms[roomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        const transport = peer.transports.get(transportId);
        if (!transport) return;
        
        await transport.connect({ dtlsParameters });
        callback();
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
        const room = rooms[roomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        const transport = peer.transports.get(transportId);
        if (!transport) return;
        
        const producer = await transport.produce({ kind, rtpParameters, appData });
        peer.producers.set(producer.id, producer);
        
        socket.to(roomName).emit('new-producer', { producerId: producer.id });
        
        callback({ id: producer.id });
    });

    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        const room = rooms[roomName];
        if (!room || !room.router.canConsume({ producerId, rtpCapabilities })) {
            return callback({ error: 'Cannot consume' });
        }
        
        const peer = room.peers.get(socket.id);
        const transport = Array.from(peer.transports.values()).find(t => !t.closed && t.appData.isSender !== true);
        if (!transport) return;

        const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true, // Всегда создаем на паузе
        });
        peer.consumers.set(consumer.id, consumer);
        
        consumer.on('producerclose', () => {
             socket.emit('producer-closed', { producerId });
        });

        callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        });
    });

    socket.on('resume', async ({ consumerId }) => {
        const room = rooms[roomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        const consumer = peer.consumers.get(consumerId);
        if (!consumer) return;
        await consumer.resume();
    });

    socket.on('disconnect', () => {
        const room = rooms[roomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        if (!peer) return;

        peer.producers.forEach(producer => {
            socket.to(roomName).emit('producer-closed', { producerId: producer.id });
        });
        
        room.peers.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Media server is running on port ${PORT}`);
});
