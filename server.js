// RuGram Signaling Server
// Nginx handles SSL, so this server only needs to run a simple WebSocket server.

const WebSocket = require('ws');

// Create a WebSocket server on localhost, port 8080
const wss = new WebSocket.Server({ host: '127.0.0.1', port: 8080 });

// Store rooms and clients. A room can have at most 2 clients.
const rooms = {};

console.log('Signaling server started on ws://127.0.0.1:8080...');

wss.on('connection', ws => {
    console.log('Client connected');

    let clientRoom = null;

    ws.on('message', message => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.log('Invalid JSON', e);
            data = {};
        }

        switch (data.type) {
            case 'join':
                console.log(`Client wants to join room: ${data.room}`);
                clientRoom = data.room;
                
                if (!rooms[clientRoom]) {
                    // First client in the room
                    rooms[clientRoom] = [ws];
                    console.log(`Room ${clientRoom} created.`);
                } else if (rooms[clientRoom].length === 1) {
                    // Second client joins
                    rooms[clientRoom].push(ws);
                    console.log(`Client joined room ${clientRoom}. Room is now full.`);
                    
                    // Notify the first client that the second one is ready to start negotiation
                    const otherClient = rooms[clientRoom][0];
                    if(otherClient.readyState === WebSocket.OPEN) {
                        otherClient.send(JSON.stringify({ type: 'ready' }));
                    }
                } else {
                    // Room is full
                    ws.send(JSON.stringify({ type: 'full' }));
                    console.log(`Room ${clientRoom} is full. Connection rejected.`);
                }
                break;
            
            // Relay messages to the other client in the same room
            case 'offer':
            case 'answer':
            case 'ice-candidate':
                console.log(`Relaying message of type ${data.type} in room ${clientRoom}`);
                if (rooms[clientRoom] && rooms[clientRoom].length === 2) {
                    const otherClient = rooms[clientRoom].find(client => client !== ws);
                    if (otherClient && otherClient.readyState === WebSocket.OPEN) {
                        otherClient.send(JSON.stringify(data));
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (clientRoom && rooms[clientRoom]) {
            // Remove the client from the room
            rooms[clientRoom] = rooms[clientRoom].filter(client => client !== ws);
            console.log(`Client removed from room ${clientRoom}`);
            
            if (rooms[clientRoom].length === 0) {
                // If the room is empty, delete it
                delete rooms[clientRoom];
                console.log(`Room ${clientRoom} deleted.`);
            } else if (rooms[clientRoom].length === 1) {
                // If one client leaves, notify the other
                const remainingClient = rooms[clientRoom][0];
                 if (remainingClient && remainingClient.readyState === WebSocket.OPEN) {
                    // This could be enhanced to signal a peer disconnect
                 }
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
