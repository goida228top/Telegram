import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

const App: React.FC = () => {
    const [roomName, setRoomName] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [consumers, setConsumers] = useState<Map<string, Consumer>>(new Map());
    const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
    const [status, setStatus] = useState('Отключено');

    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    const producerRef = useRef<Producer | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoContainerRef = useRef<HTMLDivElement>(null);

    const joinRoom = async () => {
        if (!roomName.trim()) {
            alert('Пожалуйста, введите название комнаты.');
            return;
        }

        setStatus('Подключение...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: { echoCancellation: true, noiseSuppression: true }
            });
            setLocalStream(stream);
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            const socket = io({ path: '/socket.io/' });
            socketRef.current = socket;

            socket.on('connect', async () => {
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
                           consume(producerInfo.id);
                        }
                    });

                });
            });

            socket.on('new-producer', ({ producerId }) => {
                consume(producerId);
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
            producerRef.current = await sendTransportRef.current!.produce({ track: videoTrack, appData: { mediaType: 'video' } });
        }
        if (audioTrack) {
            await sendTransportRef.current!.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
        }
    };

    const consume = async (producerId: string) => {
        const { rtpCapabilities } = deviceRef.current!;
        socketRef.current!.emit('consume', { producerId, rtpCapabilities }, async (params: any) => {
            if (params.error) {
                console.error('Ошибка создания консьюмера:', params.error);
                return;
            }

            const consumer = await recvTransportRef.current!.consume(params);
            
            // --- КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: БЕЗ ЭТОГО БУДЕТ ЧЕРНЫЙ ЭКРАН ---
            // Говорим серверу, что мы готовы получать данные
            socketRef.current!.emit('resume', { consumerId: consumer.id });

            setConsumers(prev => new Map(prev).set(producerId, consumer));

            const { track } = consumer;
            const newStream = new MediaStream([track]);
            setRemoteStreams(prev => new Map(prev).set(producerId, newStream));
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
                    <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
                    <div className="video-label">Вы</div>
                </div>
                {Array.from(remoteStreams.entries()).map(([producerId, stream]) => (
                    <div key={producerId} className={`video-wrapper active`}>
                        <video 
                            ref={(videoEl) => {
                                if (videoEl) videoEl.srcObject = stream;
                            }}
                            autoPlay 
                            playsInline 
                        />
                         <div className="video-label">Собеседник</div>
                    </div>
                ))}
            </div>

            <div className="controls-container">
                {!isConnected ? (
                    <div className="room-controls">
                        <input
                            type="text"
                            placeholder="Введите название комнаты"
                            value={roomName}
                            onChange={(e) => setRoomName(e.target.value)}
                        />
                        <button onClick={joinRoom} disabled={!roomName.trim()}>
                            Войти в комнату
                        </button>
                    </div>
                ) : (
                    <div className="call-controls">
                        <button onClick={leaveRoom} className="btn-end-call">
                            Выйти из комнаты
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
