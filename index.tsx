import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// URL указывает на прокси Nginx, который обрабатывает SSL и перенаправляет на сервер.
const SIGNALING_SERVER_URL = `wss://rugram.duckdns.org/ws/`;

const App: React.FC = () => {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [roomName, setRoomName] = useState('');
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
                alert('Не удалось получить доступ к камере и микрофону. Пожалуйста, разрешите доступ.');
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
                setCallState('connecting');
                const pc = initializePeerConnection();
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
                break;
            case 'offer':
                setCallState('connecting');
                const peerConnection = initializePeerConnection();
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: peerConnection.localDescription }));
                break;
            case 'answer':
                await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(data.sdp));
                break;
            case 'ice-candidate':
                await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
                break;
            case 'full':
                alert('Комната заполнена.');
                setCallState('idle');
                break;
            default:
                break;
        }
    };

    const connectToSignaling = () => {
        if (!roomName.trim()) {
            alert('Пожалуйста, введите название комнаты.');
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
                alert('Соединение с сервером потеряно.');
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            alert('Не удалось подключиться к сигнальному серверу. Убедитесь, что сервер запущен и доступен.');
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
        if (localStream) {
            const newMutedState = !isMuted;
            setIsMuted(newMutedState);
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !newMutedState;
            });
        }
    };

    const toggleCamera = () => {
        if (localStream) {
            const newCameraOffState = !isCameraOff;
            setIsCameraOff(newCameraOffState);
            localStream.getVideoTracks().forEach(track => {
                track.enabled = !newCameraOffState;
            });
        }
    };
    
    const renderConnectionStep = () => {
        switch (callState) {
            case 'idle':
                return (
                    <div className="room-controls">
                        <input
                            type="text"
                            placeholder="Введите название комнаты"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                            aria-label="Room Name"
                        />
                        <button onClick={connectToSignaling} disabled={!localStream || !roomName.trim()}>
                            Войти
                        </button>
                    </div>
                );
            case 'waiting':
                return <p>Ожидание другого пользователя в комнате: <strong>{roomName}</strong></p>;
            case 'connecting':
                return <p>Соединение...</p>;
            case 'connected':
                return (
                     <div className="call-controls">
                        <button onClick={toggleMute}>{isMuted ? 'Вкл. звук' : 'Выкл. звук'}</button>
                        <button onClick={toggleCamera}>{isCameraOff ? 'Вкл. камеру' : 'Выкл. камеру'}</button>
                        <button onClick={endCall} className="btn-end-call">Завершить звонок</button>
                    </div>
                )
            default:
                return null;
        }
    };

    return (
        <div className="app-container">
            <header className="header">
                <h1>RuGram Call</h1>
                <p>Безопасные видеозвонки</p>
            </header>

            <div className={`status ${connectionStatus === 'connected' ? 'status-connected' : 'status-disconnected'}`}>
                ICE Status: <strong>{connectionStatus}</strong>
            </div>
            
            <div className="videos-container">
                <div className={`video-wrapper ${localStream ? 'active' : ''}`}>
                    <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
                    <div className="video-label">Вы</div>
                </div>
                <div className={`video-wrapper ${remoteStream ? 'active' : ''}`}>
                    <video ref={remoteVideoRef} autoPlay playsInline style={{ display: remoteStream ? 'block' : 'none' }} />
                     {remoteStream && <div className="video-label">Собеседник</div>}
                </div>
            </div>
            
            <div className="controls-container">
                {renderConnectionStep()}
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
