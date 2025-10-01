import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

type RemoteStreamData = {
    stream: MediaStream;
    mediaType: 'video' | 'audio';
    isMuted?: boolean;
};

// --- SVG Icons for Controls ---
const MicOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>);
const MicOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.12.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9L19.73 21 21 19.73 4.27 3z"/></svg>);
const CamOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>);
const CamOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>);
const AvatarIcon = () => (<svg className="avatar-icon" xmlns="http://www.w3.org/2000/svg" enableBackground="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><g><rect fill="none" height="24" width="24"/></g><g><path d="M12,12c2.21,0,4-1.79,4-4s-1.79-4-4-4S8,5.79,8,8S9.79,12,12,12z M12,14c-2.67,0-8,1.34-8,4v2h16v-2 C20,15.34,14.67,14,12,14z"/></g></svg>);


const App: React.FC = () => {
    const [roomName, setRoomName] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [consumers, setConsumers] = useState<Map<string, Consumer>>(new Map());
    const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStreamData>>(new Map());
    const [status, setStatus] = useState('Отключено');
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCameraOn, setIsCameraOn] = useState(true);

    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    const videoProducerRef = useRef<Producer | null>(null);
    const audioProducerRef = useRef<Producer | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);

    const joinRoom = async (callType: 'video' | 'audio') => {
        if (!roomName.trim()) {
            alert('Пожалуйста, введите название комнаты.');
            return;
        }

        const videoEnabled = callType === 'video';
        setIsCameraOn(videoEnabled);
        setIsMicOn(true);

        setStatus('Подключение...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: { echoCancellation: true, noiseSuppression: true }
            });

            if (!videoEnabled) {
                stream.getVideoTracks()[0].enabled = false;
            }

            setLocalStream(stream);
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            const socket = io({ path: '/socket.io/' });
            socketRef.current = socket;

            socket.on('connect', () => {
                setStatus('Получение данных медиа-сервера...');
                socket.emit('getRouterRtpCapabilities', { roomName }, async (routerRtpCapabilities: any) => {
                    const device = new Device();
                    await device.load({ routerRtpCapabilities });
                    deviceRef.current = device;

                    socket.emit('createWebRtcTransport', { isSender: true }, async (params: any) => {
                        const transport = device.createSendTransport(params);
                        sendTransportRef.current = transport;

                        transport.on('connect', ({ dtlsParameters }, callback) => {
                            socket.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
                        });

                        transport.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
                            socket.emit('produce', { transportId: transport.id, kind, rtpParameters, appData }, ({ id }: { id: string }) => {
                                callback({ id });
                            });
                        });

                        await produceStream(stream);
                    });

                    socket.emit('createWebRtcTransport', { isSender: false }, async (params: any) => {
                        const transport = device.createRecvTransport(params);
                        recvTransportRef.current = transport;

                        transport.on('connect', ({ dtlsParameters }, callback) => {
                            socket.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
                        });
                    });
                    
                    socket.emit('joinRoom', { roomName }, (existingProducers: any[]) => {
                        setStatus(`В комнате: ${roomName}`);
                        setIsConnected(true);
                        for (const producerInfo of existingProducers) {
                           consume(producerInfo.id, producerInfo.appData.mediaType);
                        }
                    });
                });
            });

            socket.on('new-producer', ({ producerId, appData }) => {
                consume(producerId, appData.mediaType);
            });

            socket.on('producer-closed', ({ producerId }) => {
                const newConsumers = new Map(consumers);
                const consumer = newConsumers.get(producerId);
                if (consumer) {
                    consumer.close();
                    newConsumers.delete(producerId);
                    setConsumers(newConsumers);
                }
                
                const newRemoteStreams = new Map(remoteStreams);
                if (newRemoteStreams.has(producerId)) {
                    newRemoteStreams.delete(producerId);
                    setRemoteStreams(newRemoteStreams);
                }
            });

            socket.on('disconnect', () => {
                setStatus('Отключено');
                cleanUp();
            });

        } catch (error) {
            console.error('Не удалось получить доступ к камере или микрофону:', error);
            setStatus('Ошибка: нет доступа к камере/микрофону');
        }
    };
    
    const produceStream = async (stream: MediaStream) => {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        if (videoTrack) {
            videoProducerRef.current = await sendTransportRef.current!.produce({ track: videoTrack, appData: { mediaType: 'video' } });
        }
        if (audioTrack) {
            audioProducerRef.current = await sendTransportRef.current!.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
        }
    };

    const consume = async (producerId: string, mediaType: 'video' | 'audio') => {
        const { rtpCapabilities } = deviceRef.current!;
        socketRef.current!.emit('consume', { producerId, rtpCapabilities }, async (params: any) => {
            if (params.error) {
                console.error('Ошибка создания консьюмера:', params.error);
                return;
            }

            const consumer = await recvTransportRef.current!.consume(params);
            socketRef.current!.emit('resume', { consumerId: consumer.id });

            setConsumers(prev => new Map(prev).set(producerId, consumer));

            const { track } = consumer;

            if (mediaType === 'video') {
                track.onmute = () => {
                    setRemoteStreams(prev => {
                        const newStreams = new Map(prev);
                        const data = newStreams.get(producerId);
                        if (data) newStreams.set(producerId, { ...data, isMuted: true });
                        return newStreams;
                    });
                };
                track.onunmute = () => {
                    setRemoteStreams(prev => {
                        const newStreams = new Map(prev);
                        const data = newStreams.get(producerId);
                        if (data) newStreams.set(producerId, { ...data, isMuted: false });
                        return newStreams;
                    });
                };
            }

            const newStream = new MediaStream([track]);
            setRemoteStreams(prev => new Map(prev).set(producerId, { stream: newStream, mediaType, isMuted: consumer.track.muted }));
        });
    };
    
    const cleanUp = () => {
        localStream?.getTracks().forEach(track => track.stop());
        socketRef.current?.disconnect();
        
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();

        setIsConnected(false);
        setLocalStream(null);
        setRemoteStreams(new Map());
        setConsumers(new Map());
    };

    const leaveRoom = () => {
        cleanUp();
        setStatus('Отключено');
        setRoomName('');
    };

    const toggleMic = () => {
        if (localStream) {
            const enabled = !isMicOn;
            localStream.getAudioTracks()[0].enabled = enabled;
            setIsMicOn(enabled);
        }
    };

    const toggleCamera = () => {
        if (localStream) {
            const enabled = !isCameraOn;
            localStream.getVideoTracks()[0].enabled = enabled;
            setIsCameraOn(enabled);
        }
    };


    return (
        <div className="app-container">
            <header className="header">
                <h1>RuGram Call</h1>
                <p>Видеозвонки через выделенный сервер</p>
            </header>

            <div className={`status ${isConnected ? 'status-connected' : 'status-disconnected'}`}>
                Статус: <strong>{status}</strong>
            </div>

            <div className="videos-container">
                <div className={`video-wrapper ${localStream ? 'active' : ''}`}>
                    {isCameraOn ? (
                        <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
                    ) : <AvatarIcon />}
                    <div className="video-label">Вы</div>
                </div>
                {Array.from(remoteStreams.entries())
                    .filter(([_, data]) => data.mediaType === 'video')
                    .map(([producerId, { stream, isMuted }]) => (
                    <div key={producerId} className={`video-wrapper active`}>
                        {isMuted ? <AvatarIcon /> : (
                           <video 
                                ref={(videoEl) => {
                                    if (videoEl) videoEl.srcObject = stream;
                                }}
                                autoPlay 
                                playsInline 
                            />
                        )}
                         <div className="video-label">Собеседник</div>
                    </div>
                ))}
            </div>

            {/* Invisible audio elements */}
            {Array.from(remoteStreams.entries())
                .filter(([_, data]) => data.mediaType === 'audio')
                .map(([producerId, { stream }]) => (
                    <audio key={producerId} ref={audioEl => { if(audioEl) audioEl.srcObject = stream; }} autoPlay playsInline />
                ))
            }

            <div className="controls-container">
                {!isConnected ? (
                    <div className="room-controls">
                        <input
                            type="text"
                            placeholder="Введите название комнаты"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                        />
                        <button onClick={() => joinRoom('audio')} disabled={!roomName.trim()}>
                           Аудиозвонок
                        </button>
                        <button onClick={() => joinRoom('video')} disabled={!roomName.trim()} className="btn-video">
                            Видеозвонок
                        </button>
                    </div>
                ) : (
                    <div className="call-controls">
                        <button onClick={toggleMic} className={`btn-control ${isMicOn ? '' : 'toggled-off'}`} aria-label={isMicOn ? "Выключить микрофон" : "Включить микрофон"}>
                            {isMicOn ? <MicOnIcon /> : <MicOffIcon />}
                        </button>
                         <button onClick={toggleCamera} className={`btn-control ${isCameraOn ? '' : 'toggled-off'}`} aria-label={isCameraOn ? "Выключить камеру" : "Включить камеру"}>
                            {isCameraOn ? <CamOnIcon /> : <CamOffIcon />}
                        </button>
                        <button onClick={leaveRoom} className="btn-end-call" aria-label="Завершить звонок">
                           <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 9c-1.6 0-3.15.25-4.63.72L12 14.17l4.63-4.45A11.75 11.75 0 0012 9zm0 11.29c-3.31 0-6.28-1.28-8.54-3.32l1.46-1.32C6.63 17.4 9.11 18.5 12 18.5s5.37-1.1 7.08-2.85l1.46 1.32C18.28 19.01 15.31 20.29 12 20.29zM2.81 2.81L1.39 4.22l5.63 5.63L3.46 13.4C5.72 15.44 8.69 16.71 12 16.71s6.28-1.28 8.54-3.32l-1.46-1.32C17.37 13.84 14.89 15 12 15c-1.89 0-3.63-.56-5.07-1.5l6.05 6.05 1.41-1.41L2.81 2.81z" transform="rotate(135 12 12)"/></svg>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}