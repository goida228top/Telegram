import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

// --- Type Definitions ---
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
    clonedTrack: MediaStreamTrack;
};

type Message = {
    peerId: string;
    message: string;
    timestamp: number;
};

type CallState = 'idle' | 'calling' | 'receiving' | 'in-call';

type IncomingCallData = {
    from: string;
    callType: 'video' | 'audio';
};

// --- SVG Icons ---
const MicOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>);
const MicOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.12.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.55-.9L19.73 21 21 19.73 4.27 3z"/></svg>);
const CamOnIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>);
const CamOffIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73 3.27 2z"/></svg>);
const AvatarIcon = () => (<svg className="avatar-icon" xmlns="http://www.w3.org/2000/svg" enableBackground="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><g><rect fill="none" height="24" width="24"/></g><g><path d="M12,12c2.21,0,4-1.79,4-4s-1.79-4-4-4S8,5.79,8,8S9.79,12,12,12z M12,14c-2.67,0-8,1.34-8,4v2h16v-2 C20,15.34,14.67,14,12,14z"/></g></svg>);
const SendIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2 .01 7z"/></svg>);
const CopyIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>);

// --- Components ---

const RemotePeerComponent: React.FC<{
    peerData: RemotePeerData,
    isSpeaking: boolean
}> = ({ peerData, isSpeaking }) => {
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

const ChatPanel: React.FC<{ 
    messages: Message[],
    localPeerId: string | null,
    onSendMessage: (message: string) => void
}> = ({ messages, localPeerId, onSendMessage }) => {
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newMessage.trim()) {
            onSendMessage(newMessage.trim());
            setNewMessage('');
        }
    };

    return (
        <div className="chat-panel">
            <div className="chat-messages">
                {messages.map((msg) => (
                    <div key={msg.timestamp} className={`message ${msg.peerId === localPeerId ? 'sent' : 'received'}`}>
                        <div className="message-sender">{msg.peerId === localPeerId ? 'Вы' : 'Собеседник'}</div>
                        {msg.message}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <form className="chat-form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    placeholder="Введите сообщение..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                />
                <button type="submit" aria-label="Отправить сообщение"><SendIcon/></button>
            </form>
        </div>
    );
};


// --- Utility Functions ---
const getMediaStream = async (prefersVideo: boolean): Promise<{ stream: MediaStream; videoEnabled: boolean }> => {
    const audioConstraints = { echoCancellation: true, noiseSuppression: true };

    if (!prefersVideo) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            return { stream, videoEnabled: false };
        } catch (err) {
            console.error('Failed to get audio-only stream:', err);
            throw err;
        }
    }

    const videoConstraintsPresets = [
        { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        { facingMode: 'user' },
        true
    ];

    let lastError: any = null;

    for (const constraints of videoConstraintsPresets) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: constraints,
                audio: audioConstraints
            });
            return { stream, videoEnabled: true };
        } catch (err: any) {
            lastError = err;
            if (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError' && err.name !== 'NotReadableError') {
                break;
            }
        }
    }
    
    console.warn('All video attempts failed. Falling back to audio-only.');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        return { stream, videoEnabled: false };
    } catch (audioErr) {
        console.error('Audio-only fallback also failed:', audioErr);
        throw lastError || audioErr;
    }
};

// --- Main App Component ---
const App: React.FC = () => {
    const [myId, setMyId] = useState<string | null>(null);
    const [peerIdToCall, setPeerIdToCall] = useState('');
    const [callState, setCallState] = useState<CallState>('idle');
    const [incomingCallData, setIncomingCallData] = useState<IncomingCallData | null>(null);
    
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [consumers, setConsumers] = useState<Map<string, Consumer>>(new Map());
    const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeerData>>(new Map());
    const [status, setStatus] = useState('Отключено');
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [speakingStates, setSpeakingStates] = useState<Map<string, boolean>>(new Map());
    const [messages, setMessages] = useState<Message[]>([]);
    const [copied, setCopied] = useState(false);
    
    const currentRoomNameRef = useRef<string | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    const videoProducerRef = useRef<Producer | null>(null);
    const audioProducerRef = useRef<Producer | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const analysisRefs = useRef<Map<string, AnalysisData>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);
    
    useEffect(() => {
        const socket = io({ path: '/socket.io/' });
        socketRef.current = socket;

        socket.on('connect', () => {
            setMyId(socket.id);
            setStatus('Готов к звонку');
        });
        
        socket.on('incoming-call', (data: IncomingCallData) => {
            if (callState !== 'idle') return; // Ignore if already busy
            setIncomingCallData(data);
            setCallState('receiving');
        });
        
        socket.on('call-started', ({ roomName, callType }) => {
            startCallSession(roomName, callType);
        });
        
        socket.on('peer-unavailable', () => {
            alert('Собеседник не найден или не в сети.');
            setCallState('idle');
            setStatus('Готов к звонку');
        });
        
        socket.on('peer-declined', () => {
            alert('Собеседник отклонил вызов.');
            setCallState('idle');
            setStatus('Готов к звонку');
        });
        
        socket.on('new-producer', ({ producerId, appData, peerId }) => {
            if (peerId === socket.id) return;
            consume(producerId, appData.mediaType, peerId);
        });
        
        socket.on('newMessage', ({ peerId, message }) => {
            setMessages(prev => [...prev, { peerId, message, timestamp: Date.now() }]);
        });

        socket.on('producer-closed', ({ producerId }) => {
             handleProducerClosed(producerId);
        });
        
        socket.on('disconnect', () => {
            setStatus('Переподключение...');
            cleanUp();
        });

        return () => {
            socket.disconnect();
            cleanUp();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps


    const unlockAudio = async () => {
        if (!audioContextRef.current) {
             audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }
    };

    const setupAudioAnalysis = (stream: MediaStream, id: string) => {
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || analysisRefs.current.has(id) || !audioContextRef.current) return;

        // FIX: Clone the audio track for analysis to prevent stream conflicts
        const clonedTrack = audioTrack.clone();
        const analysisStream = new MediaStream([clonedTrack]);
        
        const audioContext = audioContextRef.current;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.5;

        const source = audioContext.createMediaStreamSource(analysisStream);
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

        analysisRefs.current.set(id, { context: audioContext, source, analyser, animationFrameId, clonedTrack });
    };

    const stopAudioAnalysis = (id: string) => {
        const analysisData = analysisRefs.current.get(id);
        if (analysisData) {
            cancelAnimationFrame(analysisData.animationFrameId);
            analysisData.source.disconnect();
            analysisData.analyser.disconnect();
            // FIX: Stop the cloned track to release resources
            analysisData.clonedTrack.stop();
            analysisRefs.current.delete(id);
        }
        setSpeakingStates(prev => {
            if (!prev.has(id)) return prev;
            const newStates = new Map(prev);
            newStates.delete(id);
            return newStates;
        });
    };
    
    const handleCall = (callType: 'video' | 'audio') => {
        if (!peerIdToCall.trim() || !myId) {
            alert('Пожалуйста, введите ID собеседника.');
            return;
        }
        if (peerIdToCall.trim() === myId) {
            alert('Вы не можете позвонить самому себе.');
            return;
        }
        
        setCallState('calling');
        setStatus(`Звонок к ${peerIdToCall}...`);
        socketRef.current?.emit('call-peer', { peerIdToCall: peerIdToCall.trim(), callType });
    };
    
    const handleAcceptCall = async (callType: 'video' | 'audio') => {
        if (!incomingCallData) return;
        socketRef.current?.emit('call-accepted', { to: incomingCallData.from, callType });
        // The server will respond with 'call-started', which triggers startCallSession
    };
    
    const handleDeclineCall = () => {
        if (!incomingCallData) return;
        socketRef.current?.emit('call-declined', { to: incomingCallData.from });
        setCallState('idle');
        setIncomingCallData(null);
    };

    const startCallSession = async (roomName: string, callType: 'video' | 'audio') => {
        currentRoomNameRef.current = roomName;

        await unlockAudio();
        setStatus('Запрос доступа...');

        try {
            const { stream, videoEnabled } = await getMediaStream(callType === 'video');

            setStatus(videoEnabled ? 'Подключение...' : 'Подключение в аудио-режиме...');
            
            setIsCameraOn(videoEnabled);
            setIsMicOn(true);
            
            setLocalStream(stream);
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            setupAudioAnalysis(stream, socketRef.current?.id || 'local');

            setStatus('Получение данных медиа-сервера...');
            socketRef.current?.emit('getRouterRtpCapabilities', { roomName }, async (routerRtpCapabilities: any) => {
                const device = new Device();
                await device.load({ routerRtpCapabilities });
                deviceRef.current = device;

                socketRef.current?.emit('joinRoom', { roomName }, async (existingProducers: any[]) => {
                    socketRef.current?.emit('createWebRtcTransport', { isSender: true }, async (sendParams: any) => {
                        const sendTransport = device.createSendTransport(sendParams);
                        sendTransportRef.current = sendTransport;

                        sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                            socketRef.current?.emit('connectTransport', { transportId: sendTransport.id, dtlsParameters }, callback);
                        });

                        sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
                            socketRef.current?.emit('produce', { transportId: sendTransport.id, kind, rtpParameters, appData }, ({ id }: { id: string }) => {
                                callback({ id });
                            });
                        });

                        socketRef.current?.emit('createWebRtcTransport', { isSender: false }, async (recvParams: any) => {
                            const recvTransport = device.createRecvTransport(recvParams);
                            recvTransportRef.current = recvTransport;

                            recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                                socketRef.current?.emit('connectTransport', { transportId: recvTransport.id, dtlsParameters }, callback);
                            });

                            setStatus(`В разговоре`);
                            setCallState('in-call');
                            setIncomingCallData(null);
                            
                            await produceStream(stream);

                            for (const producerInfo of existingProducers) {
                               consume(producerInfo.id, producerInfo.appData.mediaType, producerInfo.peerId);
                            }
                        });
                    });
                });
            });

        } catch (error: any) {
            console.error('Error starting call session:', error);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                setStatus('Ошибка: вы не разрешили доступ к камере/микрофону.');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                 setStatus('Ошибка: камера или микрофон не найдены.');
            } else {
                setStatus('Ошибка: нет доступа к камере/микрофону');
            }
            cleanUp();
        }
    };
    
    const produceStream = async (stream: MediaStream) => {
        if (!sendTransportRef.current) return;
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
        if (!deviceRef.current || !socketRef.current || !recvTransportRef.current) return;

        const { rtpCapabilities } = deviceRef.current;
        socketRef.current.emit('consume', { producerId, rtpCapabilities }, async (params: any) => {
            if (params.error) return console.error('Consume error:', params.error);

            const consumer = await recvTransportRef.current!.consume(params);
            socketRef.current!.emit('resume', { consumerId: consumer.id });

            setConsumers(prev => new Map(prev).set(producerId, consumer));

            const { track } = consumer;
            
            setRemotePeers((prev) => {
                const newPeers = new Map(prev);
                const oldData = newPeers.get(peerId);
                const existingTracks = oldData?.stream?.getTracks().filter(t => t.kind !== track.kind) || [];
                const newStream = new MediaStream([...existingTracks, track]);
        
                const newData: RemotePeerData = {
                    stream: newStream,
                    videoProducerId: mediaType === 'video' ? producerId : oldData?.videoProducerId || null,
                    audioProducerId: mediaType === 'audio' ? producerId : oldData?.audioProducerId || null,
                };
        
                if (mediaType === 'audio') setupAudioAnalysis(newStream, peerId);
        
                newPeers.set(peerId, newData);
                return newPeers;
            });
        });
    };
    
    const handleProducerClosed = (producerId: string) => {
        const consumer = consumers.get(producerId);
        if (consumer) {
            consumer.close();
            const newConsumers = new Map(consumers);
            newConsumers.delete(producerId);
            setConsumers(newConsumers);
        }
        
        setRemotePeers((prev) => {
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
                        if (isVideo) newData.videoProducerId = null;
                        else {
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
    };
    
    const handleSendMessage = (message: string) => {
        if (socketRef.current && currentRoomNameRef.current) {
            socketRef.current.emit('sendMessage', { roomName: currentRoomNameRef.current, message });
            setMessages(prev => [...prev, { peerId: socketRef.current!.id, message, timestamp: Date.now() }]);
        }
    };
    
    const cleanUp = () => {
        stopAudioAnalysis(socketRef.current?.id || 'local');
        analysisRefs.current.forEach((_, id) => stopAudioAnalysis(id));

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(console.error);
            audioContextRef.current = null;
        }

        localStream?.getTracks().forEach(track => track.stop());
        
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();

        setCallState('idle');
        setIncomingCallData(null);
        setLocalStream(null);
        setRemotePeers(new Map());
        setConsumers(new Map());
        setSpeakingStates(new Map());
        setMessages([]);
        currentRoomNameRef.current = null;
        deviceRef.current = null;
        sendTransportRef.current = null;
        recvTransportRef.current = null;
    };

    const leaveCall = () => {
        socketRef.current?.emit('leaveRoom');
        cleanUp();
        setStatus('Готов к звонку');
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
    
    const copyMyId = () => {
        if (myId) {
            navigator.clipboard.writeText(myId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const renderContent = () => {
        if (callState === 'in-call') {
            return (
                <>
                    <div className="videos-container">
                        <div className={`video-wrapper ${localStream ? 'active' : ''} ${speakingStates.get(socketRef.current?.id || 'local') ? 'speaking' : ''}`}>
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
                     <ChatPanel 
                        messages={messages} 
                        localPeerId={socketRef.current?.id || null} 
                        onSendMessage={handleSendMessage} 
                    />
                </>
            );
        }

        if (callState === 'receiving' && incomingCallData) {
            return (
                <div className="centered-overlay">
                    <div className="incoming-call-modal">
                         <h3>Входящий вызов</h3>
                         <p>от <strong>{incomingCallData.from}</strong></p>
                         <div className="call-actions">
                             <button onClick={() => handleAcceptCall('audio')}>Принять аудио</button>
                             <button onClick={() => handleAcceptCall('video')} className="btn-video">Принять с видео</button>
                             <button onClick={handleDeclineCall} className="btn-decline">Отклонить</button>
                         </div>
                    </div>
                </div>
            );
        }
        
        // idle or calling
        return (
            <div className="centered-overlay">
                <div className="idle-controls">
                     <div className="my-id-container">
                         <label>Ваш ID для подключения:</label>
                         <div className="id-display">
                            <span>{myId || 'Подключение...'}</span>
                            <button onClick={copyMyId} disabled={!myId} title="Копировать ID">
                                {copied ? 'Скопировано!' : <CopyIcon />}
                            </button>
                         </div>
                     </div>
                     <input
                         type="text"
                         placeholder="Введите ID собеседника"
                         value={peerIdToCall}
                         onChange={(e) => setPeerIdToCall(e.target.value)}
                         disabled={callState === 'calling'}
                     />
                     <div className="call-actions">
                         <button onClick={() => handleCall('audio')} disabled={!peerIdToCall.trim() || callState === 'calling'}>
                            Аудиозвонок
                         </button>
                         <button onClick={() => handleCall('video')} disabled={!peerIdToCall.trim() || callState === 'calling'} className="btn-video">
                             Видеозвонок
                         </button>
                     </div>
                </div>
            </div>
        );
    };

    return (
        <div className="app-container">
            <header className="header">
                <h1>RuGram</h1>
                <div className={`status ${callState === 'in-call' ? 'status-connected' : 'status-disconnected'}`}>
                    Статус: <strong>{status}</strong>
                </div>
            </header>

            <main className={`main-content ${callState === 'in-call' ? 'in-call' : ''}`}>
                {renderContent()}
            </main>

            <footer className="controls-container">
                {callState === 'in-call' ? (
                    <div className="call-controls">
                        <button onClick={toggleMic} className={`btn-control ${isMicOn ? '' : 'toggled-off'}`} aria-label={isMicOn ? "Выключить микрофон" : "Включить микрофон"}>
                            {isMicOn ? <MicOnIcon /> : <MicOffIcon />}
                        </button>
                         <button onClick={toggleCamera} className={`btn-control ${isCameraOn ? '' : 'toggled-off'}`} aria-label={isCameraOn ? "Выключить камеру" : "Включить камеру"} disabled={!localStream?.getVideoTracks()[0]}>
                            {isCameraOn ? <CamOnIcon /> : <CamOffIcon />}
                        </button>
                        <button onClick={leaveCall} className="btn-end-call" aria-label="Завершить звонок">
                           <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 9c-1.6 0-3.15.25-4.63.72L12 14.17l4.63-4.45A11.75 11.75 0 0012 9zm0 11.29c-3.31 0-6.28-1.28-8.54-3.32l1.46-1.32C6.63 17.4 9.11 18.5 12 18.5s5.37-1.1 7.08-2.85l1.46 1.32C18.28 19.01 15.31 20.29 12 20.29zM2.81 2.81L1.39 4.22l5.63 5.63L3.46 13.4C5.72 15.44 8.69 16.71 12 16.71s6.28-1.28 8.54-3.32l-1.46-1.32C17.37 13.84 14.89 15 12 15c-1.89 0-3.63-.56-5.07-1.5l6.05 6.05 1.41-1.41L2.81 2.81z" transform="rotate(135 12 12)"/></svg>
                        </button>
                    </div>
                ): <div className="footer-placeholder">Ожидание звонка...</div>}
            </footer>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}