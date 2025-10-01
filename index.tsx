
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

// A single stream will hold both audio and video tracks for a peer
type RemotePeerData = {
    stream: MediaStream | null;
    videoProducerId: string | null;
    audioProducerId: string | null;
};

type AnalysisData = {
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    animationFrameId: number;
};

// --- SVG Icons for Controls ---
const MicOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>);
const MicOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.12.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9L19.73 21 21 19.73 4.27 3z"/></svg>);
const CamOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>);
const CamOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>);
const AvatarIcon = () => (<svg className="avatar-icon" xmlns="http://www.w3.org/2000/svg" enableBackground="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><g><rect fill="none" height="24" width="24"/></g><g><path d="M12,12c2.21,0,4-1.79,4-4s-1.79-4-4-4S8,5.79,8,8S9.79,12,12,12z M12,14c-2.67,0-8,1.34-8,4v2h16v-2 C20,15.34,14.67,14,12,14z"/></g></svg>);


// This component now handles a single combined stream for a peer.
const RemotePeerComponent: React.FC<{
    peerData: RemotePeerData,
    isSpeaking: boolean
}> = ({ peerData, isSpeaking }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current && peerData.stream) {
            videoRef.current.srcObject = peerData.stream;
            // Explicitly unmute remote streams
            videoRef.current.muted = false;
        }
    }, [peerData.stream]);

    const hasVideo = peerData.stream?.getVideoTracks().some(track => track.readyState === 'live' && !track.muted);

    return (
        <div className={`video-wrapper active ${isSpeaking ? 'speaking' : ''}`}>
            {/* The video element is always rendered to play audio. Its visibility depends on a video track. */}
            <video ref={videoRef} autoPlay playsInline style={{ visibility: hasVideo ? 'visible' : 'hidden' }} />
            
            {!hasVideo && <AvatarIcon />}

            <div className="video-label">Собеседник</div>
        </div>
    );
};


const App: React.FC = () => {
    const [roomName, setRoomName] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [consumers, setConsumers] = useState<Map<string, Consumer>>(new Map());
    const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerData>>(new Map());
    const [status, setStatus] = useState('Отключено');
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [speakingStates, setSpeakingStates] = useState<Map<string, boolean>>(new Map());

    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    const videoProducerRef = useRef<Producer | null>(null);
    const audioProducerRef = useRef<Producer | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const analysisRefs = useRef<Map<string, AnalysisData>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);

    // Function to unlock the AudioContext, crucial for autoplay policies
    const unlockAudio = async () => {
        if (!audioContextRef.current) {
             audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            console.log('AudioContext is suspended, resuming...');
            try {
                await audioContextRef.current.resume();
                console.log('AudioContext resumed successfully.');
            } catch (err) {
                console.error('Failed to resume AudioContext:', err);
            }
        }
    };

    const setupAudioAnalysis = (stream: MediaStream, id: string) => {
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || analysisRefs.current.has(id) || !audioContextRef.current) return;

        const audioContext = audioContextRef.current;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let animationFrameId: number;

        const checkVolume = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            const isSpeaking = average > 20;

            setSpeakingStates(prev => {
                if (prev.get(id) === isSpeaking) return prev;
                const newStates = new Map(prev);
                newStates.set(id, isSpeaking);
                return newStates;
            });

            animationFrameId = requestAnimationFrame(checkVolume);
        };
        animationFrameId = requestAnimationFrame(checkVolume);

        analysisRefs.current.set(id, { context: audioContext, source, analyser, animationFrameId });
    };

    const stopAudioAnalysis = (id: string) => {
        const analysisData = analysisRefs.current.get(id);
        if (analysisData) {
            cancelAnimationFrame(analysisData.animationFrameId);
            analysisData.source.disconnect();
            analysisData.analyser.disconnect();
            // We don't close the shared context here
            analysisRefs.current.delete(id);
        }
        setSpeakingStates(prev => {
            if (!prev.has(id)) return prev;
            const newStates = new Map(prev);
            newStates.delete(id);
            return newStates;
        });
    };

    const joinRoom = async (callType: 'video' | 'audio') => {
        if (!roomName.trim()) {
            alert('Пожалуйста, введите название комнаты.');
            return;
        }

        // --- KEY FIX: Unlock audio context on user gesture ---
        await unlockAudio();

        let stream: MediaStream;
        let videoEnabled = callType === 'video';
        
        setStatus('Подключение...');
        try {
            if (videoEnabled) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
                        audio: { echoCancellation: true, noiseSuppression: true }
                    });
                } catch (err: any) {
                    console.warn('Не удалось получить видео, пробую только аудио:', err);
                    if (err.name === 'NotReadableError' || err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
                        setStatus('Камера недоступна, пробуем аудио...');
                        videoEnabled = false;
                        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
                    } else {
                        throw err;
                    }
                }
            } else {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            }
            
            setIsCameraOn(videoEnabled);
            setIsMicOn(true);
            
            setLocalStream(stream);
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            setupAudioAnalysis(stream, 'local');

            const socket = io({ path: '/socket.io/' });
            socketRef.current = socket;

            socket.on('connect', () => {
                setStatus('Получение данных медиа-сервера...');
                socket.emit('getRouterRtpCapabilities', { roomName }, async (routerRtpCapabilities: any) => {
                    const device = new Device();
                    await device.load({ routerRtpCapabilities });
                    deviceRef.current = device;

                    socket.emit('joinRoom', { roomName }, async (existingProducers: any[]) => {
                        socket.emit('createWebRtcTransport', { isSender: true }, async (sendParams: any) => {
                            const sendTransport = device.createSendTransport(sendParams);
                            sendTransportRef.current = sendTransport;

                            sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                                socket.emit('connectTransport', { transportId: sendTransport.id, dtlsParameters }, callback);
                            });

                            sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                                socket.emit('produce', { transportId: sendTransport.id, kind, rtpParameters, appData }, ({ id }: { id: string }) => {
                                    callback({ id });
                                });
                            });

                            socket.emit('createWebRtcTransport', { isSender: false }, async (recvParams: any) => {
                                const recvTransport = device.createRecvTransport(recvParams);
                                recvTransportRef.current = recvTransport;

                                recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                                    socket.emit('connectTransport', { transportId: recvTransport.id, dtlsParameters }, callback);
                                });

                                setStatus(`В комнате: ${roomName}`);
                                setIsConnected(true);
                                
                                await produceStream(stream);

                                for (const producerInfo of existingProducers) {
                                   consume(producerInfo.id, producerInfo.appData.mediaType, producerInfo.peerId);
                                }
                            });
                        });
                    });
                });
            });

            socket.on('new-producer', ({ producerId, appData, peerId }) => {
                if (peerId === socket.id) return;
                consume(producerId, appData.mediaType, peerId);
            });

            socket.on('producer-closed', ({ producerId }) => {
                const consumer = consumers.get(producerId);
                if (consumer) {
                    consumer.close();
                    const newConsumers = new Map(consumers);
                    newConsumers.delete(producerId);
                    setConsumers(newConsumers);
                }
                
                setRemotePeers(prev => {
                    const newPeers = new Map(prev);
                    let peerIdToUpdate: string | null = null;
                    
                    for (const [peerId, data] of newPeers.entries()) {
                        if (data.videoProducerId === producerId || data.audioProducerId === producerId) {
                            peerIdToUpdate = peerId;
                            break;
                        }
                    }
                    
                    if (peerIdToUpdate) {
                        const oldData = newPeers.get(peerIdToUpdate)!;
                        const isVideo = oldData.videoProducerId === producerId;
                        const trackToRemove = isVideo 
                            ? oldData.stream?.getVideoTracks()[0] 
                            : oldData.stream?.getAudioTracks()[0];
            
                        if (trackToRemove && oldData.stream) {
                            const remainingTracks = oldData.stream.getTracks().filter(t => t.id !== trackToRemove.id);
            
                            if (remainingTracks.length > 0) {
                                const newData = { ...oldData };
                                newData.stream = new MediaStream(remainingTracks);
                                if (isVideo) {
                                    newData.videoProducerId = null;
                                } else {
                                    newData.audioProducerId = null;
                                    stopAudioAnalysis(peerIdToUpdate);
                                }
                                newPeers.set(peerIdToUpdate, newData);
                            } else {
                                stopAudioAnalysis(peerIdToUpdate);
                                newPeers.delete(peerIdToUpdate);
                            }
                        } else {
                             stopAudioAnalysis(peerIdToUpdate);
                             newPeers.delete(peerIdToUpdate);
                        }
                    }
                    return newPeers;
                });
            });

            socket.on('disconnect', () => {
                setStatus('Отключено');
                cleanUp();
            });

        } catch (error) {
            console.error('Не удалось получить доступ к камере или микрофону:', error);
            setStatus('Ошибка: нет доступа к камере/микрофону');
            cleanUp();
        }
    };
    
    const produceStream = async (stream: MediaStream) => {
        if (!sendTransportRef.current) {
            console.error("Send transport is not ready.");
            return;
        }
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        
        if (isCameraOn && videoTrack) {
            videoProducerRef.current = await sendTransportRef.current.produce({ track: videoTrack, appData: { mediaType: 'video' } });
        }
        if (audioTrack) {
            audioProducerRef.current = await sendTransportRef.current.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
        }
    };

    const consume = async (producerId: string, mediaType: 'video' | 'audio', peerId: string) => {
        if (!deviceRef.current || !socketRef.current || !recvTransportRef.current) {
            return;
        }
        const { rtpCapabilities } = deviceRef.current;
        socketRef.current.emit('consume', { producerId, rtpCapabilities }, async (params: any) => {
            if (params.error) {
                console.error('Ошибка создания консьюмера:', params.error);
                return;
            }

            const consumer = await recvTransportRef.current!.consume(params);
            socketRef.current!.emit('resume', { consumerId: consumer.id });

            setConsumers(prev => new Map(prev).set(producerId, consumer));

            const { track } = consumer;
            
            setRemotePeers(prev => {
                const newPeers = new Map(prev);
                const oldData = newPeers.get(peerId);
                const existingTracks = oldData?.stream?.getTracks().filter(t => t.kind !== track.kind) || [];
                const newStream = new MediaStream([...existingTracks, track]);
        
                const newData = {
                    stream: newStream,
                    videoProducerId: mediaType === 'video' ? producerId : oldData?.videoProducerId || null,
                    audioProducerId: mediaType === 'audio' ? producerId : oldData?.audioProducerId || null,
                };
        
                if (mediaType === 'audio') {
                    setupAudioAnalysis(newStream, peerId);
                }
        
                newPeers.set(peerId, newData);
                return newPeers;
            });
        });
    };
    
    const cleanUp = () => {
        stopAudioAnalysis('local');
        analysisRefs.current.forEach((_, id) => stopAudioAnalysis(id));

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(console.error);
            audioContextRef.current = null;
        }

        localStream?.getTracks().forEach(track => track.stop());
        socketRef.current?.disconnect();
        
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();

        setIsConnected(false);
        setLocalStream(null);
        setRemotePeers(new Map());
        setConsumers(new Map());
        setSpeakingStates(new Map());
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
        if (localStream && localStream.getVideoTracks().length > 0) {
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
                <div className={`video-wrapper ${localStream ? 'active' : ''} ${speakingStates.get('local') ? 'speaking' : ''}`}>
                    {isCameraOn && localStream?.getVideoTracks().length > 0 ? (
                        <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
                    ) : <AvatarIcon />}
                    <div className="video-label">Вы</div>
                </div>
                {Array.from(remotePeers.entries()).map(([peerId, peerData]) => (
                    <RemotePeerComponent
                        key={peerId}
                        peerData={peerData}
                        isSpeaking={!!speakingStates.get(peerId)}
                    />
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
                         <button onClick={toggleCamera} className={`btn-control ${isCameraOn ? '' : 'toggled-off'}`} aria-label={isCameraOn ? "Выключить камеру" : "Включить камеру"} disabled={!localStream?.getVideoTracks()[0]}>
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
