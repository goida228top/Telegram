import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// IMPORTANT: Replace with your server's domain or IP address.
// Using wss:// (WebSocket Secure) to match the secure HTTPS origin.
const SIGNALING_SERVER_URL = `wss://rugram.duckdns.org:8080`;

const App: React.FC = () => {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [roomName, setRoomName] = useState('');
    
    // 'idle': Start screen, not connected to signaling server
    // 'waiting': Connected to room, waiting for peer
    // 'connecting': Peer joined, WebRTC connection in progress
    // 'connected': Call is active
    const [callState, setCallState] = useState<'idle' | 'waiting' | 'connecting' | 'connected'>('idle');
    const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
    
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    const STUN_SERVERS = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
    };

    useEffect(() => {
        const startMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                setLocalStream(stream);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            } catch (error) {
                console.error('Error accessing media devices.', error);
                alert('Could not access camera and microphone. Please allow permissions.');
            }
        };
        startMedia();

        return () => {
            localStream?.getTracks().forEach(track => track.stop());
            wsRef.current?.close();
            peerConnectionRef.current?.close();
        };
    }, []);
    
    const initializePeerConnection = () => {
        const pc = new RTCPeerConnection(STUN_SERVERS);

        pc.onicecandidate = event => {
            if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
            }
        };

        pc.ontrack = event => {
            setRemoteStream(event.streams[0]);
            if (remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = event.streams[0];
            }
        };
        
        pc.oniceconnectionstatechange = () => {
            if(pc.iceConnectionState) {
                setConnectionStatus(pc.iceConnectionState);
                if (pc.iceConnectionState === 'connected') {
                    setCallState('connected');
                }
                if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                    if (callState === 'connected') {
                        endCall();
                    }
                }
            }
        };

        localStream?.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });

        peerConnectionRef.current = pc;
        return pc;
    };

    const handleSignalingData = async (data: any) => {
        switch (data.type) {
            case 'ready':
                // The other user is ready, so the creator of the room sends the offer
                setCallState('connecting');
                const pc = initializePeerConnection();
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
                break;
            case 'offer':
                // The user joining the room receives the offer
                setCallState('connecting');
                const peerConnection = initializePeerConnection();
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: peerConnection.localDescription }));
                break;
            case 'answer':
                // The room creator receives the answer
                await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(data.sdp));
                break;
            case 'ice-candidate':
                await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
                break;
            case 'full':
                alert('Room is full.');
                setCallState('idle');
                break;
            default:
                break;
        }
    };

    const connectToSignaling = () => {
        if (!roomName) {
            alert('Please enter a room name.');
            return;
        }

        const ws = new WebSocket(SIGNALING_SERVER_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'join', room: roomName }));
            setCallState('waiting');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleSignalingData(data);
        };

        ws.onclose = () => {
            if (callState !== 'idle') {
                endCall();
                alert('Connection to server lost.');
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            alert('Failed to connect to the signaling server. Make sure the server is running and accessible.');
            setCallState('idle');
        };
    };

    const endCall = () => {
        peerConnectionRef.current?.close();
        peerConnectionRef.current = null;
        wsRef.current?.close();
        wsRef.current = null;
        setRemoteStream(null);
        setCallState('idle');
        setConnectionStatus('Disconnected');
        setRoomName('');
    };

    const toggleMute = () => {
        localStream?.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setIsMuted(prev => !prev);
    };

    const toggleCamera = () => {
        localStream?.getVideoTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setIsCameraOff(prev => !prev);
    };

    const renderConnectionSteps = () => {
        switch (callState) {
            case 'idle':
                return (
                    <>
                        <h2>Start or Join a Call</h2>
                        <p>Enter a room name to create or join a call.</p>
                        <input
                            type="text"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                            placeholder="Enter room name"
                            aria-label="Room Name"
                        />
                        <div className="button-group">
                            <button onClick={connectToSignaling} disabled={!localStream || !roomName}>Create / Join Room</button>
                        </div>
                    </>
                );
            case 'waiting':
                return (
                    <>
                        <h2>Waiting for another user...</h2>
                        <p>You are in room: <strong>{roomName}</strong></p>
                        <p>Share this room name with the person you want to call.</p>
                    </>
                );
            case 'connecting':
                 return <h2>Connecting...</h2>;
            case 'connected':
                return <h2>Call in Progress</h2>;
            default:
                return null;
        }
    };

    return (
        <div className="app-container">
            <header className="header">
                <h1>RuGram Call</h1>
                <p>Simple Peer-to-Peer Calling</p>
            </header>
            <div className="status" aria-live="polite">
                Connection Status: <strong>{connectionStatus}</strong>
            </div>
            <div className="videos-container">
                <div className="video-wrapper">
                    <video ref={localVideoRef} autoPlay playsInline muted />
                    <div className="video-label">You</div>
                </div>
                <div className="video-wrapper">
                    <video ref={remoteVideoRef} autoPlay playsInline />
                    <div className="video-label">Remote</div>
                </div>
            </div>

            <div className="controls-container">
                <h3>Call Controls</h3>
                <div className="button-group">
                    <button onClick={toggleMute} disabled={!localStream}>
                        {isMuted ? 'Unmute' : 'Mute'}
                    </button>
                    <button onClick={toggleCamera} disabled={!localStream}>
                        {isCameraOff ? 'Camera On' : 'Camera Off'}
                    </button>
                    <button onClick={endCall} disabled={callState === 'idle'}>
                        End Call
                    </button>
                </div>
            </div>
            
            <div className="sdp-container">
                {renderConnectionSteps()}
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
