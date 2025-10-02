// RuGram Signaling & Media Server v5.0 (с поддержкой вызовов по ID)
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
    console.log(`[INFO] Creating new private room: ${roomName}`);
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

            socket.on('call-peer', ({ peerIdToCall, callType }) => {
                const targetSocket = io.sockets.sockets.get(peerIdToCall);
                if (targetSocket) {
                    console.log(`[INFO] Relaying call from ${socket.id} to ${peerIdToCall}`);
                    targetSocket.emit('incoming-call', { from: socket.id, callType });
                } else {
                    console.log(`[WARN] Peer ${peerIdToCall} not found for call from ${socket.id}`);
                    socket.emit('peer-unavailable');
                }
            });

            socket.on('call-accepted', async ({ to, callType }) => {
                const callerSocket = io.sockets.sockets.get(to);
                if (!callerSocket) {
                     console.log(`[WARN] Original caller ${to} not found.`);
                     return;
                }
                const roomName = `${to}-${socket.id}`;
                await createRoom(roomName);

                console.log(`[INFO] Call accepted between ${to} and ${socket.id}. Creating room ${roomName}`);
                
                callerSocket.emit('call-started', { roomName, callType });
                socket.emit('call-started', { roomName, callType });
            });
            
            socket.on('call-declined', ({ to }) => {
                const callerSocket = io.sockets.sockets.get(to);
                if (callerSocket) {
                    console.log(`[INFO] Call from ${to} to ${socket.id} was declined.`);
                    callerSocket.emit('peer-declined');
                }
            });


            // --- Mediasoup specific logic ---

            socket.on('getRouterRtpCapabilities', async ({ roomName }, callback) => {
                const room = rooms[roomName];
                if (room) {
                    callback(room.router.rtpCapabilities);
                }
            });

            socket.on('joinRoom', ({ roomName }, callback) => {
                if (!rooms[roomName]) {
                    console.error(`[ERROR] Attempted to join non-existent room: ${roomName}`);
                    return;
                }
                
                currentRoomName = roomName;
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
            
            socket.on('sendMessage', ({ roomName, message }) => {
                socket.to(roomName).emit('newMessage', { peerId: socket.id, message });
            });
            
            socket.on('leaveRoom', () => {
                // This is a soft leave, the hard leave is in 'disconnect'
                if (!currentRoomName) return;
                const room = rooms[currentRoomName];
                if (!room) return;
                socket.leave(currentRoomName);
                 const peer = room.peers.get(socket.id);
                if (peer) {
                    peer.producers.forEach(producer => {
                        producer.close();
                         socket.to(currentRoomName).emit('producer-closed', { producerId: producer.id });
                    });
                }
            });

            socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
                const room = rooms[currentRoomName];
                if (!room) return;
                
                const transport = await room.router.createWebRtcTransport({
                    listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
                    enableUdp: true,
                    enableTcp: true,
                    preferUdp: true,
                    appData: { isSender }
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
                
                const producer = await transport.produce({ kind, rtpParameters, appData });
                peer.producers.set(producer.id, producer);
                
                socket.to(currentRoomName).emit('new-producer', { producerId: producer.id, appData: producer.appData, peerId: socket.id });
                
                callback({ id: producer.id });
            });

            socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
                const room = rooms[currentRoomName];
                if (!room || !room.router.canConsume({ producerId, rtpCapabilities })) {
                    return callback({ error: 'Cannot consume' });
                }
                
                const peer = room.peers.get(socket.id);
                if (!peer) return callback({ error: 'Peer not found' });

                const transport = Array.from(peer.transports.values()).find(t => t.appData.isSender !== true);
                if (!transport) return callback({ error: 'No recv transport found' });
                
                try {
                    const consumer = await transport.consume({
                        producerId,
                        rtpCapabilities,
                        paused: true,
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

                await consumer.resume();
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
                
                if (room.peers.size === 0) {
                    console.log(`[INFO] Closing empty room: ${currentRoomName}`);
                    room.router.close();
                    delete rooms[currentRoomName];
                }
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
