// RuGram Media Server v5.0 (Email Authentication)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: '/socket.io/', cors: { origin: "*" } });

const PORT = 3001;
const rooms = new Map(); // { roomName: { router, peers: Map } }
const users = new Map(); // { email: { socketId, verificationCode, codeTimestamp, isAuthenticated } }
const socketIdToEmail = new Map(); // { socketId: email }
let worker;

const mediaCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
];

const createWorker = async () => {
    const w = await mediasoup.createWorker({ logLevel: 'warn' });
    w.on('died', () => {
        console.error('mediasoup worker died, exiting...');
        setTimeout(() => process.exit(1), 2000);
    });
    return w;
};

const getOrCreateRoom = async (roomName) => {
    if (rooms.has(roomName)) {
        return rooms.get(roomName);
    }
    const router = await worker.createRouter({ mediaCodecs });
    const room = { router, peers: new Map() };
    rooms.set(roomName, room);
    return room;
};

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

async function run() {
    worker = await createWorker();
    console.log('[INFO] Mediasoup worker initialized.');

    io.on('connection', (socket) => {
        let currentRoomName;

        // --- Authentication Logic ---
        socket.on('register-email', ({ email }) => {
            const code = generateCode();
            users.set(email, {
                socketId: socket.id,
                verificationCode: code,
                codeTimestamp: Date.now(),
                isAuthenticated: false,
            });
            socketIdToEmail.set(socket.id, email);
            console.log(`[AUTH] Verification code for ${email} is ${code}`);
            // --- SIMULATED EMAIL SEND ---
            socket.emit('verification-code-sent', { code });
        });

        socket.on('verify-code', ({ email, code }) => {
            const userData = users.get(email);
            if (!userData || userData.socketId !== socket.id) {
                return socket.emit('error', { message: 'Session error. Please try again.' });
            }
            if (userData.verificationCode !== code) {
                return socket.emit('error', { message: 'Invalid verification code.' });
            }
            if (Date.now() - userData.codeTimestamp > 300000) { // 5-minute expiry
                return socket.emit('error', { message: 'Code has expired.' });
            }
            userData.isAuthenticated = true;
            users.set(email, userData);
            socket.emit('login-success', { email });
        });
        
        // --- Call Signaling Logic ---
        socket.on('call-user', ({ calleeEmail }) => {
            const callerEmail = socketIdToEmail.get(socket.id);
            const calleeData = users.get(calleeEmail);
            if (calleeData && calleeData.isAuthenticated && calleeData.socketId) {
                io.to(calleeData.socketId).emit('incoming-call', { callerEmail });
            } else {
                 socket.emit('user-unavailable', {email: calleeEmail});
            }
        });
        
        socket.on('accept-call', ({ callerEmail }) => {
            const callerData = users.get(callerEmail);
            const calleeEmail = socketIdToEmail.get(socket.id);
            if (callerData && callerData.socketId) {
                const roomName = crypto.randomUUID(); // Create a private room for this call
                io.to(callerData.socketId).emit('call-accepted', { roomName });
                io.to(socket.id).emit('call-accepted', { roomName });
            }
        });
        
        socket.on('reject-call', ({ callerEmail }) => {
            const callerData = users.get(callerEmail);
            if(callerData && callerData.socketId) {
                io.to(callerData.socketId).emit('call-rejected');
            }
        });


        // --- Mediasoup Logic (Mostly unchanged, but now uses dynamic room names) ---
        socket.on('getRouterRtpCapabilities', async ({ roomName }, callback) => {
            currentRoomName = roomName;
            const room = await getOrCreateRoom(roomName);
            callback(room.router.rtpCapabilities);
        });

        socket.on('joinRoom', ({ roomName }, callback) => {
            if (!rooms.has(roomName)) return;
            socket.join(roomName);
            const room = rooms.get(roomName);
            const existingProducers = [];
            room.peers.forEach((peerData, peerId) => {
                peerData.producers.forEach(p => existingProducers.push({ id: p.id, appData: p.appData, peerId }));
            });
            const peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
            room.peers.set(socket.id, peer);
            callback(existingProducers);
        });

        socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
            const room = rooms.get(currentRoomName);
            if (!room) return;
            const transport = await room.router.createWebRtcTransport({
                listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
                enableUdp: true, enableTcp: true, preferUdp: true, appData: { isSender }
            });
            const peer = room.peers.get(socket.id);
            peer.transports.set(transport.id, transport);
            callback({ id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters });
        });

        socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
            const peer = rooms.get(currentRoomName)?.peers.get(socket.id);
            const transport = peer?.transports.get(transportId);
            if (!transport) return;
            await transport.connect({ dtlsParameters });
            callback();
        });

        socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
            const peer = rooms.get(currentRoomName)?.peers.get(socket.id);
            const transport = peer?.transports.get(transportId);
            if (!transport) return;
            const producer = await transport.produce({ kind, rtpParameters, appData });
            peer.producers.set(producer.id, producer);
            socket.to(currentRoomName).emit('new-producer', { producerId: producer.id, appData: producer.appData, peerId: socket.id });
            callback({ id: producer.id });
        });

        socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
            const room = rooms.get(currentRoomName);
            if (!room || !room.router.canConsume({ producerId, rtpCapabilities })) return callback({ error: 'Cannot consume' });
            const peer = room.peers.get(socket.id);
            const transport = Array.from(peer.transports.values()).find(t => !t.appData.isSender);
            if (!transport) return callback({ error: 'No recv transport' });
            try {
                const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
                peer.consumers.set(consumer.id, consumer);
                consumer.on('producerclose', () => socket.emit('producer-closed', { producerId }));
                callback({ id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
            } catch (error) {
                callback({ error: error.message });
            }
        });

        socket.on('resume', async ({ consumerId }) => {
            const peer = rooms.get(currentRoomName)?.peers.get(socket.id);
            const consumer = peer?.consumers.get(consumerId);
            if (consumer) await consumer.resume();
        });

        socket.on('disconnect', () => {
            const email = socketIdToEmail.get(socket.id);
            if (email) {
                users.delete(email);
                socketIdToEmail.delete(socket.id);
                console.log(`[AUTH] User ${email} disconnected and cleaned up.`);
            }

            if (!currentRoomName) return;
            const room = rooms.get(currentRoomName);
            if (!room) return;
            const peer = room.peers.get(socket.id);
            if (!peer) return;
            peer.producers.forEach(p => {
                p.close();
                socket.to(currentRoomName).emit('producer-closed', { producerId: p.id });
            });
            peer.transports.forEach(t => t.close());
            room.peers.delete(socket.id);
        });
        
         socket.on('leave-call', () => {
             // Similar logic to disconnect but initiated by user
             if (!currentRoomName) return;
             const room = rooms.get(currentRoomName);
             if (!room) return;
             const peer = room.peers.get(socket.id);
             if (!peer) return;
             peer.producers.forEach(p => {
                p.close();
                socket.to(currentRoomName).emit('producer-closed', { producerId: p.id });
            });
            peer.transports.forEach(t => t.close());
            room.peers.delete(socket.id);
         });
    });

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Media server is running on port ${PORT}`);
    });
}

run();
