import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

type UiState = 'login' | 'verify' | 'calling' | 'in-call' | 'incoming-call';
type CallType = 'audio' | 'video';

type RemotePeerData = {
    stream: MediaStream | null;
    videoProducerId: string | null;
    audioProducerId: string | null;
};

type AnalysisData = {
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    animationFrameId: number;
};

// --- SVG Icons ---
const MicOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>);
const MicOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.12.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9L19.73 21 21 19.73 4.27 3z"/></svg>);
const CamOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>);
const CamOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>);
const AvatarIcon = () => (<svg className="avatar-icon" xmlns="http://www.w3.org/2000/svg" enableBackground="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><g><rect fill="none" height="24" width="24"/></g><g><path d="M12,12c2.21,0,4-1.79,4-4s-1.79-4-4-4S8,5.79,8,8S9.79,12,12,12z M12,14c-2.67,0-8,1.34-8,4v2h16v-2 C20,15.34,14.67,14,12,14z"/></g></svg>);

// --- Components ---

const RemotePeerComponent: React.FC<{ peerData: RemotePeerData, isSpeaking: boolean }> = ({ peerData, isSpeaking }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (videoRef.current && peerData.stream) {
            videoRef.current.srcObject = peerData.stream;
            videoRef.current.muted = false;
        }
    }, [peerData.stream]);
    const hasVideo = peerData.stream?.getVideoTracks().some(track => track.readyState === 'live' && !track.muted);
    return (
        <div className={`video-wrapper active ${isSpeaking ? 'speaking' : ''}`}>
            <video ref={videoRef} autoPlay playsInline style={{ visibility: hasVideo ? 'visible' : 'hidden' }} />
            {!hasVideo && <AvatarIcon />}
            <div className="video-label">Собеседник</div>
        </div>
    );
};

const IncomingCallModal: React.FC<{ callerEmail: string, onAccept: (callType: CallType) => void, onReject: () => void }> = ({ callerEmail, onAccept, onReject }) => (
    <div className="overlay">
        <div className="modal">
            <h2>Входящий звонок</h2>
            <p>Вам звонит <strong>{callerEmail}</strong></p>
            <div className="modal-actions">
                <button onClick={onReject} className="btn-end-call">Отклонить</button>
                <button onClick={() => onAccept('audio')}>Принять аудио</button>
                <button onClick={() => onAccept('video')} className="btn-video">Принять видео</button>
            </div>
        </div>
    </div>
);


const getMediaStream = async (prefersVideo: boolean): Promise<{ stream: MediaStream; videoEnabled: boolean }> => {
    const audioConstraints = { echoCancellation: true, noiseSuppression: true };
    if (!prefersVideo) {
        return { stream: await navigator.mediaDevices.getUserMedia({ audio: audioConstraints }), videoEnabled: false };
    }
    const videoConstraintsPresets = [
        { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        { facingMode: 'user' },
        true
    ];
    for (const constraints of videoConstraintsPresets) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: audioConstraints });
            return { stream, videoEnabled: true };
        } catch (err: any) {
            if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError' && err.name !== 'NotReadableError') throw err;
        }
    }
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: audioConstraints }), videoEnabled: false };
};

const App: React.FC = () => {
    const [uiState, setUiState] = useState<UiState>('login');
    const [email, setEmail] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [status, setStatus] = useState('Не в сети');
    const [userEmail, setUserEmail] = useState('');
    const [peerEmail, setPeerEmail] = useState('');
    const [incomingCall, setIncomingCall] = useState<{ callerEmail: string } | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerData>>(new Map());
    const [consumers, setConsumers] = useState<Map<string, Consumer>>(new Map());
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [speakingStates, setSpeakingStates] = useState<Map<string, boolean>>(new Map());

    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const analysisRefs = useRef<Map<string, AnalysisData>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);

    useEffect(() => {
        const socket = io({ path: '/socket.io/' });
        socketRef.current = socket;

        socket.on('verification-code-sent', ({ code }) => {
            console.log(`--- ВАШ КОД ВЕРИФИКАЦИИ: ${code} ---`);
            alert(`Код верификации (также в консоли): ${code}`);
            setUiState('verify');
        });

        socket.on('login-success', ({ email }) => {
            setUserEmail(email);
            setUiState('calling');
            setStatus(`В сети как ${email}`);
        });

        socket.on('error', ({ message }) => {
            alert(message);
            setStatus(`Ошибка: ${message}`);
        });

        socket.on('incoming-call', ({ callerEmail }) => {
            setIncomingCall({ callerEmail });
            setUiState('incoming-call');
        });

        socket.on('call-accepted', ({ roomName }) => {
            joinRoom(roomName, true); // Assume video for now, can be enhanced
        });
        
        socket.on('call-rejected', () => {
             alert('Ваш вызов был отклонен.');
             cleanUp();
        });
        
        socket.on('user-unavailable', ({email}) => {
             alert(`Пользователь ${email} не в сети или недоступен.`);
             cleanUp();
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    const handleRegister = () => {
        if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
            alert('Пожалуйста, введите корректный email.');
            return;
        }
        socketRef.current?.emit('register-email', { email });
    };

    const handleVerify = () => {
        if (!verificationCode.trim() || verificationCode.length !== 6) {
            alert('Пожалуйста, введите 6-значный код.');
            return;
        }
        socketRef.current?.emit('verify-code', { email, code: verificationCode });
    };

    const handleCall = (callType: CallType) => {
        if (!peerEmail.trim()) {
            alert('Введите Email собеседника');
            return;
        }
        socketRef.current?.emit('call-user', { calleeEmail: peerEmail, callType });
        setStatus(`Звонок пользователю ${peerEmail}...`);
    };

    const handleAcceptCall = async (callType: CallType) => {
        if (!incomingCall) return;
        socketRef.current?.emit('accept-call', { callerEmail: incomingCall.callerEmail });
        setUiState('in-call');
        // The 'call-accepted' event from server will trigger joinRoom
    };

    const handleRejectCall = () => {
        if (!incomingCall) return;
        socketRef.current?.emit('reject-call', { callerEmail: incomingCall.callerEmail });
        setIncomingCall(null);
        setUiState('calling');
    };

    const unlockAudio = async () => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }
    };
    
    const cloneAudioStreamForAnalysis = (stream: MediaStream): MediaStream | null => {
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) return null;
        
        const clonedAudioTrack = audioTracks[0].clone();
        return new MediaStream([clonedAudioTrack]);
    };

    const setupAudioAnalysis = (stream: MediaStream, id: string) => {
        const analysisStream = cloneAudioStreamForAnalysis(stream);
        if (!analysisStream || analysisRefs.current.has(id) || !audioContextRef.current) return;

        const audioContext = audioContextRef.current;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        const source = audioContext.createMediaStreamSource(analysisStream);
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const checkVolume = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            const isSpeaking = average > 15;
            setSpeakingStates(prev => {
                if (prev.get(id) === isSpeaking) return prev;
                const newStates = new Map(prev);
                newStates.set(id, isSpeaking);
                return newStates;
            });
            analysisRefs.current.get(id)!.animationFrameId = requestAnimationFrame(checkVolume);
        };
        const animationFrameId = requestAnimationFrame(checkVolume);
        analysisRefs.current.set(id, { source, analyser, animationFrameId });
    };

    const stopAudioAnalysis = (id: string) => {
        const analysisData = analysisRefs.current.get(id);
        if (analysisData) {
            cancelAnimationFrame(analysisData.animationFrameId);
            analysisData.source.mediaStream.getTracks().forEach(track => track.stop());
            analysisData.source.disconnect();
            analysisData.analyser.disconnect();
            analysisRefs.current.delete(id);
        }
        setSpeakingStates(prev => {
            const newStates = new Map(prev);
            newStates.delete(id);
            return newStates;
        });
    };
    
    const joinRoom = async (roomName: string, prefersVideo: boolean) => {
        await unlockAudio();
        setStatus('Запрос доступа...');
        try {
            const { stream, videoEnabled } = await getMediaStream(prefersVideo);
            setStatus(prefersVideo && !videoEnabled ? 'Подключение в аудио-режиме...' : 'Подключение...');
            setIsCameraOn(videoEnabled);
            setIsMicOn(true);
            setLocalStream(stream);
            if (localVideoRef.current) localVideoRef.current.srcObject = stream;
            
            setupAudioAnalysis(stream, 'local');

            setStatus('Получение данных медиа-сервера...');
            socketRef.current?.emit('getRouterRtpCapabilities', { roomName }, async (routerRtpCapabilities: any) => {
                const device = new Device();
                await device.load({ routerRtpCapabilities });
                deviceRef.current = device;

                socketRef.current?.emit('joinRoom', { roomName }, (existingProducers: any[]) => {
                    socketRef.current?.emit('createWebRtcTransport', { isSender: true }, async (sendParams: any) => {
                        const sendTransport = device.createSendTransport(sendParams);
                        sendTransportRef.current = sendTransport;
                        sendTransport.on('connect', ({ dtlsParameters }, cb) => socketRef.current?.emit('connectTransport', { transportId: sendTransport.id, dtlsParameters }, cb));
                        sendTransport.on('produce', async (params, cb) => socketRef.current?.emit('produce', { transportId: sendTransport.id, ...params }, ({ id }) => cb({ id })));

                        socketRef.current?.emit('createWebRtcTransport', { isSender: false }, async (recvParams: any) => {
                            const recvTransport = device.createRecvTransport(recvParams);
                            recvTransportRef.current = recvTransport;
                            recvTransport.on('connect', ({ dtlsParameters }, cb) => socketRef.current?.emit('connectTransport', { transportId: recvTransport.id, dtlsParameters }, cb));

                            setStatus('В звонке');
                            setUiState('in-call');
                            produceStream(stream);
                            existingProducers.forEach(p => consume(p.id, p.appData.mediaType, p.peerId));
                        });
                    });
                });
            });

            socketRef.current?.on('new-producer', ({ producerId, appData, peerId }) => {
                if (peerId === socketRef.current?.id) return;
                consume(producerId, appData.mediaType, peerId);
            });

            socketRef.current?.on('producer-closed', ({ producerId }) => {
                const consumer = consumers.get(producerId);
                if (consumer) {
                    consumer.close();
                    setConsumers(prev => { const m = new Map(prev); m.delete(producerId); return m; });
                }
                setRemotePeers((prev: Map<string, RemotePeerData>) => {
                    const newPeers = new Map(prev);
                    let peerIdToUpdate: string | null = null;
                    newPeers.forEach((data, peerId) => {
                        if (data.videoProducerId === producerId || data.audioProducerId === producerId) peerIdToUpdate = peerId;
                    });
                    if (peerIdToUpdate) {
                        const peerData = newPeers.get(peerIdToUpdate)!;
                        const isVideo = peerData.videoProducerId === producerId;
                        const trackToRemove = isVideo ? peerData.stream?.getVideoTracks()[0] : peerData.stream?.getAudioTracks()[0];
                        if (trackToRemove && peerData.stream) {
                            const remaining = peerData.stream.getTracks().filter(t => t.id !== trackToRemove.id);
                            if (remaining.length > 0) {
                                newPeers.set(peerIdToUpdate, { ...peerData, stream: new MediaStream(remaining), videoProducerId: isVideo ? null : peerData.videoProducerId, audioProducerId: !isVideo ? null : peerData.audioProducerId });
                                if (!isVideo) stopAudioAnalysis(peerIdToUpdate);
                            } else {
                                stopAudioAnalysis(peerIdToUpdate);
                                newPeers.delete(peerIdToUpdate);
                            }
                        }
                    }
                    return newPeers;
                });
            });

        } catch (error: any) {
            console.error('Ошибка медиа:', error);
            setStatus(error.name === 'NotAllowedError' ? 'Ошибка: доступ не разрешен.' : 'Ошибка: нет камеры/микрофона.');
            cleanUp();
        }
    };
    
    const produceStream = async (stream: MediaStream) => {
        if (!sendTransportRef.current) return;
        const videoTrack = stream.getVideoTracks()[0];
        if (isCameraOn && videoTrack) await sendTransportRef.current.produce({ track: videoTrack, appData: { mediaType: 'video' } });
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) await sendTransportRef.current.produce({ track: audioTrack, appData: { mediaType: 'audio' } });
    };

    const consume = async (producerId: string, mediaType: 'video' | 'audio', peerId: string) => {
        if (!deviceRef.current || !socketRef.current || !recvTransportRef.current) return;
        const { rtpCapabilities } = deviceRef.current;
        socketRef.current.emit('consume', { producerId, rtpCapabilities }, async (params: any) => {
            if (params.error) return console.error('Ошибка консьюмера:', params.error);
            const consumer = await recvTransportRef.current!.consume(params);
            socketRef.current!.emit('resume', { consumerId: consumer.id });
            setConsumers(prev => new Map(prev).set(producerId, consumer));
            const { track } = consumer;
            setRemotePeers((prev: Map<string, RemotePeerData>) => {
                const newPeers = new Map(prev);
                const oldData = newPeers.get(peerId);
                const existingTracks = oldData?.stream?.getTracks().filter(t => t.kind !== track.kind) || [];
                const newStream = new MediaStream([...existingTracks, track]);
                if (mediaType === 'audio') setupAudioAnalysis(newStream, peerId);
                newPeers.set(peerId, { stream: newStream, videoProducerId: mediaType === 'video' ? producerId : oldData?.videoProducerId, audioProducerId: mediaType === 'audio' ? producerId : oldData?.audioProducerId });
                return newPeers;
            });
        });
    };
    
    const cleanUp = () => {
        stopAudioAnalysis('local');
        analysisRefs.current.forEach((_, id) => stopAudioAnalysis(id));
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
        audioContextRef.current = null;
        localStream?.getTracks().forEach(track => track.stop());
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();
        setLocalStream(null);
        setRemotePeers(new Map());
        setConsumers(new Map());
        setSpeakingStates(new Map());
        setUiState('calling');
        setStatus(`В сети как ${userEmail}`);
    };

    const leaveCall = () => {
        socketRef.current?.emit('leave-call'); // Inform server to clean up room etc.
        cleanUp();
    };

    const toggleMic = () => { localStream?.getAudioTracks().forEach(t => t.enabled = !isMicOn); setIsMicOn(!isMicOn); };
    const toggleCamera = () => { localStream?.getVideoTracks().forEach(t => t.enabled = !isCameraOn); setIsCameraOn(!isCameraOn); };

    return (
        <div className="app-container">
            {incomingCall && uiState === 'incoming-call' &&
                <IncomingCallModal callerEmail={incomingCall.callerEmail} onAccept={handleAcceptCall} onReject={handleRejectCall} />
            }

            <header className="header">
                <h1>RuGram Call</h1>
                <p>Видеозвонки по email</p>
            </header>

            {uiState !== 'login' && uiState !== 'verify' &&
                <div className={`status ${uiState === 'in-call' ? 'status-connected' : 'status-disconnected'}`}>
                    Статус: <strong>{status}</strong>
                </div>
            }

            {uiState === 'in-call' &&
                <div className="videos-container">
                    <div className={`video-wrapper active ${speakingStates.get('local') ? 'speaking' : ''}`}>
                        {isCameraOn && localStream?.getVideoTracks().length > 0 ? (
                            <video ref={localVideoRef} className="local-video" autoPlay playsInline muted />
                        ) : <AvatarIcon />}
                        <div className="video-label">{userEmail} (Вы)</div>
                    </div>
                    {Array.from(remotePeers.entries()).map(([peerId, peerData]) => (
                        <RemotePeerComponent key={peerId} peerData={peerData} isSpeaking={!!speakingStates.get(peerId)} />
                    ))}
                </div>
            }

            <div className="controls-container">
                {uiState === 'login' && (
                    <div className="auth-container">
                        <h2>Вход или регистрация</h2>
                        <div className="auth-form">
                           <input type="email" placeholder="Введите ваш Email" value={email} onChange={e => setEmail(e.target.value)} />
                           <button onClick={handleRegister}>Получить код</button>
                        </div>
                    </div>
                )}
                {uiState === 'verify' && (
                    <div className="auth-container">
                        <h2>Подтверждение</h2>
                        <div className="auth-form">
                          <p>Мы "отправили" код на <strong>{email}</strong>. Проверьте консоль разработчика (F12).</p>
                          <input type="text" placeholder="6-значный код" value={verificationCode} onChange={e => setVerificationCode(e.target.value)} maxLength={6}/>
                          <button onClick={handleVerify}>Войти</button>
                        </div>
                    </div>
                )}
                {uiState === 'calling' && (
                    <div className="auth-container">
                        <h2>Совершить звонок</h2>
                        <div className="auth-form">
                           <input type="email" placeholder="Введите Email собеседника" value={peerEmail} onChange={e => setPeerEmail(e.target.value)} />
                           <div style={{display: 'flex', gap: '1rem', width: '100%'}}>
                             <button onClick={() => handleCall('audio')} disabled={!peerEmail.trim()}>Аудиозвонок</button>
                             <button onClick={() => handleCall('video')} disabled={!peerEmail.trim()} className="btn-video">Видеозвонок</button>
                           </div>
                        </div>
                    </div>
                )}
                {uiState === 'in-call' && (
                    <div className="call-controls">
                        <button onClick={toggleMic} className={`btn-control ${isMicOn ? '' : 'toggled-off'}`}><MicOnIcon /></button>
                        <button onClick={toggleCamera} className={`btn-control ${isCameraOn ? '' : 'toggled-off'}`} disabled={!localStream?.getVideoTracks()[0]}><CamOnIcon /></button>
                        <button onClick={leaveCall} className="btn-end-call"><svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 9c-1.6 0-3.15.25-4.63.72L12 14.17l4.63-4.45A11.75 11.75 0 0012 9zm0 11.29c-3.31 0-6.28-1.28-8.54-3.32l1.46-1.32C6.63 17.4 9.11 18.5 12 18.5s5.37-1.1 7.08-2.85l1.46 1.32C18.28 19.01 15.31 20.29 12 20.29zM2.81 2.81L1.39 4.22l5.63 5.63L3.46 13.4C5.72 15.44 8.69 16.71 12 16.71s6.28-1.28 8.54-3.32l-1.46-1.32C17.37 13.84 14.89 15 12 15c-1.89 0-3.63-.56-5.07-1.5l6.05 6.05 1.41-1.41L2.81 2.81z" transform="rotate(135 12 12)"/></svg></button>
                    </div>
                )}
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App />);
}
