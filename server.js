// RuGram Media Server v4.1 (стабильная версия с улучшенным запуском)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors: {
    origin: "*",
  },
});

const PORT = 3001;
const rooms = {}; // { roomName: { router, peers: Map<socketId, peer> } }
let worker;

const mediaCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
];

const createWorker = async () => {
    const w = await mediasoup.createWorker({
        logLevel: 'warn',
    });

    w.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds...');
        setTimeout(() => process.exit(1), 2000);
    });
    return w;
};

const createRoom = async (roomName) => {
    if (rooms[roomName]) {
        return rooms[roomName];
    }
    console.log(`[INFO] Creating new room: ${roomName}`);
    const router = await worker.createRouter({ mediaCodecs });
    rooms[roomName] = { router, peers: new Map() };
    return rooms[roomName];
};

async function run() {
    try {
        console.log('[INFO] Initializing mediasoup worker...');
        worker = await createWorker();
        console.log('[INFO] Mediasoup worker initialized successfully.');

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
                rooms[roomName].peers.forEach((peerData, peerId) => {
                    peerData.producers.forEach(producer => {
                        existingProducers.push({ id: producer.id, appData: producer.appData, peerId });
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
                    listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || null }],
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
                socket.to(currentRoomName).emit('new-producer', { producerId: producer.id, appData: producer.appData, peerId: socket.id });
                
                callback({ id: producer.id });
            });

            socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
                const room = rooms[currentRoomName];
                if (!room || !room.router.canConsume({ producerId, rtpCapabilities })) {
                    console.error(`[ERROR] Peer ${socket.id} cannot consume producer ${producerId}`);
                    return callback({ error: 'Cannot consume' });
                }
                
                const peer = room.peers.get(socket.id);
                if (!peer) {
                    return callback({ error: 'Peer not found' });
                }

                const transport = Array.from(peer.transports.values()).find(t => t.appData.isSender !== true);
                if (!transport) {
                    console.error(`[ERROR] Peer ${socket.id} has no recv transport`);
                    return callback({ error: 'No recv transport found' });
                }
                
                console.log(`[INFO] Peer ${socket.id} consuming producer ${producerId}`);
                try {
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
                } catch(error) {
                    console.error(`[ERROR] Consume failed for peer ${socket.id}`, error);
                    return callback({ error: error.message });
                }
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
            
            socket.on('chatMessage', ({ roomName, message }) => {
                if (!roomName || typeof message !== 'string' || message.trim() === '' || !rooms[roomName]) {
                    console.log(`[WARN] Invalid chat message received from ${socket.id}`);
                    return;
                }
                console.log(`[INFO] Chat message in room ${roomName} from ${socket.id}: ${message}`);
                // Broadcast to all clients in the room, including the sender.
                io.to(roomName).emit('newChatMessage', { peerId: socket.id, message: message.trim() });
            });

            socket.on('disconnect', () => {
                if (!currentRoomName) return;
                const room = rooms[currentRoomName];
                if (!room) return;
                const peer = room.peers.get(socket.id);
                if (!peer) return;

                console.log(`[INFO] Peer ${socket.id} disconnected from room ${currentRoomName}`);
                
                peer.producers.forEach(producer => {
                    producer.close();
                    socket.to(currentRoomName).emit('producer-closed', { producerId: producer.id });
                });
                
                peer.transports.forEach(transport => transport.close());

                room.peers.delete(socket.id);
            });
        });

        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Media server is running on port ${PORT}`);
        });

    } catch (error) {
        console.error('[FATAL] Failed to start media server:', error);
        process.exit(1);
    }
}

run();