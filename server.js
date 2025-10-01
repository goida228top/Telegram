// RuGram Media Server v4 (стабильная версия)
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
    console.log(`[INFO] Creating new room: ${roomName}`);
    const router = await worker.createRouter({ mediaCodecs });
    rooms[roomName] = { router, peers: new Map() };
    return rooms[roomName];
};

io.on('connection', (socket) => {
    let currentRoomName;

    socket.on('getRouterRtpCapabilities', async ({ roomName }, callback) => {
        currentRoomName = roomName;
        const room = await createRoom(roomName);
        console.log(`[INFO] Peer ${socket.id} getting capabilities for room ${roomName}`);
        callback(room.router.rtpCapabilities);
    });

    socket.on('joinRoom', ({ roomName }, callback) => {
        if (!rooms[roomName]) {
            return;
        }
        
        console.log(`[INFO] Peer ${socket.id} joining room ${roomName}`);
        socket.join(roomName);

        const existingProducers = [];
        rooms[roomName].peers.forEach(peer => {
            peer.producers.forEach(producer => {
                existingProducers.push({ id: producer.id });
            });
        });
        
        const peer = {
            transports: new Map(),
            producers: new Map(),
            consumers: new Map(),
        };
        rooms[roomName].peers.set(socket.id, peer);

        callback(existingProducers);
    });

    socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
        const room = rooms[currentRoomName];
        if (!room) return;
        
        console.log(`[INFO] Peer ${socket.id} creating ${isSender ? 'send' : 'recv'} transport`);
        const transport = await room.router.createWebRtcTransport({
            listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            appData: { isSender } // Store if it's a sender transport
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
        const room = rooms[currentRoomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        if (!peer) return;
        const transport = peer.transports.get(transportId);
        if (!transport) return;
        
        console.log(`[INFO] Peer ${socket.id} connecting transport ${transport.id}`);
        await transport.connect({ dtlsParameters });
        callback();
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
        const room = rooms[currentRoomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        if (!peer) return;
        const transport = peer.transports.get(transportId);
        if (!transport) return;
        
        console.log(`[INFO] Peer ${socket.id} producing ${kind}`);
        const producer = await transport.produce({ kind, rtpParameters, appData });
        peer.producers.set(producer.id, producer);
        
        // Inform other peers in the room
        socket.to(currentRoomName).emit('new-producer', { producerId: producer.id });
        
        callback({ id: producer.id });
    });

    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        const room = rooms[currentRoomName];
        if (!room || !room.router.canConsume({ producerId, rtpCapabilities })) {
            console.error(`[ERROR] Peer ${socket.id} cannot consume producer ${producerId}`);
            return callback({ error: 'Cannot consume' });
        }
        
        const peer = room.peers.get(socket.id);
        if (!peer) return;

        // Find the recv transport
        const transport = Array.from(peer.transports.values()).find(t => t.appData.isSender !== true);
        if (!transport) {
            console.error(`[ERROR] Peer ${socket.id} has no recv transport`);
            return;
        }
        
        console.log(`[INFO] Peer ${socket.id} consuming producer ${producerId}`);
        const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true,
        });
        peer.consumers.set(consumer.id, consumer);
        
        consumer.on('producerclose', () => {
             console.log(`[INFO] Consumer for peer ${socket.id} closed because producer ${producerId} closed`);
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
        const room = rooms[currentRoomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        if (!peer) return;
        const consumer = peer.consumers.get(consumerId);
        if (!consumer) return;

        console.log(`[INFO] Peer ${socket.id} resuming consumer ${consumerId}`);
        await consumer.resume();
    });

    socket.on('disconnect', () => {
        if (!currentRoomName) return;
        const room = rooms[currentRoomName];
        if (!room) return;
        const peer = room.peers.get(socket.id);
        if (!peer) return;

        console.log(`[INFO] Peer ${socket.id} disconnected from room ${currentRoomName}`);
        
        // Close all producers for this peer and notify others
        peer.producers.forEach(producer => {
            producer.close();
            socket.to(currentRoomName).emit('producer-closed', { producerId: producer.id });
        });
        
        // Close all transports for this peer
        peer.transports.forEach(transport => transport.close());

        room.peers.delete(socket.id);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Media server is running on port ${PORT}`);
});
