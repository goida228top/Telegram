import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';
import { types as mediasoupTypes } from 'mediasoup-client';


// --- Types ---
type View = 'contacts' | 'chat';
type CallState = 'idle' | 'incoming' | 'outgoing' | 'active';
type CallType = 'audio' | 'video';

type Contact = { id: string; };
type FriendRequest = { fromId: string; };
type PrivateMessage = {
    id: string;
    text: string;
    senderId: string;
    timestamp: number;
};

// --- Helper Functions for Local Storage ---
const Storage = {
    getDeviceId: (): string => {
        let storedId = localStorage.getItem('rugram-device-id');
        if (!storedId) {
            storedId = crypto.randomUUID();
            localStorage.setItem('rugram-device-id', storedId);
        }
        return storedId;
    },
    getContacts: (): Contact[] => {
        const data = localStorage.getItem('rugram-contacts');
        return data ? JSON.parse(data) : [];
    },
    saveContacts: (contacts: Contact[]) => {
        localStorage.setItem('rugram-contacts', JSON.stringify(contacts));
    },
    getFriendRequests: (): FriendRequest[] => {
        const data = localStorage.getItem('rugram-friend-requests');
        return data ? JSON.parse(data) : [];
    },
    saveFriendRequests: (requests: FriendRequest[]) => {
        localStorage.setItem('rugram-friend-requests', JSON.stringify(requests));
    },
    getMessages: (): Record<string, PrivateMessage[]> => {
        const data = localStorage.getItem('rugram-messages');
        return data ? JSON.parse(data) : {};
    },
    saveMessages: (messages: Record<string, PrivateMessage[]>) => {
        localStorage.setItem('rugram-messages', JSON.stringify(messages));
    }
};

// --- SVG Icons ---
const MoreVertIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>);
const CopyIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" enableBackground="new 0 0 24 24" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><g><rect fill="none" height="24" width="24"/></g><g><path d="M16,1H4C2.9,1,2,1.9,2,3v14h2V3h12V1z M19,5H8C6.9,5,6,5.9,6,7v14c0,1.1,0.9,2,2,2h11c1.1,0,2-0.9,2-2V7C21,5.9,20.1,5,19,5z M19,21H8V7h11V21z"/></g></svg>);
const BackIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>);
const AudioCallIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M6.54 5c.06.89.21 1.76.45 2.59l-1.2 1.2c-.41-1.2-.67-2.47-.76-3.79h1.51m10.92 0h1.51c-.09 1.32-.35 2.59-.76 3.79l-1.2-1.2c.24-.83.39-1.7.45-2.59M12 3c-4.97 0-9 4.03-9 9c0 1.25.26 2.45.7 3.55L12 15l8.3-8.45c.44-1.1.7-2.3.7-3.55c0-4.97-4.03-9-9-9z"/></svg>);
const CallEndIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.18-.29-.43-.29-.71s.11-.53.29-.71c1.32-1.32 2.85-2.34 4.54-3.01.62-.25 1.28-.42 1.96-.52C8.13 6.01 10 5 12 5c6.08 0 11 4.93 11 11 0 2.87-1.1 5.5-2.93 7.42-.18.18-.43.29-.71.29s-.53-.11-.71-.29l-2.47-2.47c-.18-.18-.28-.43-.28-.71 0-.27.1-.52.28-.7.73-.78 1.36-1.67 1.85-2.66.16-.32.51-.56.9-.56h3.1c-.47-1.45-.72-3-1.02-4.6z"/></svg>);

// --- Components ---

const CallView: React.FC<{
    myId: string;
    peerId: string;
    onHangUp: () => void;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
}> = ({ myId, peerId, onHangUp, localStream, remoteStream }) => {
    const localAudioRef = useRef<HTMLAudioElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (localAudioRef.current && localStream) {
            localAudioRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteAudioRef.current && remoteStream) {
            remoteAudioRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);

    return (
        <div className="call-view">
            <div className="call-participant-box local-participant">
                <div className="avatar-placeholder">👤</div>
                <span className="participant-name">Вы</span>
            </div>
            <div className="call-participant-box remote-participant">
                <div className="avatar-placeholder">👤</div>
                <span className="participant-name">{peerId.substring(0, 8)}...</span>
            </div>

            <audio ref={localAudioRef} autoPlay muted playsInline />
            <audio ref={remoteAudioRef} autoPlay playsInline />

            <div className="call-controls">
                <button onClick={onHangUp} className="btn-hang-up">
                    <CallEndIcon />
                </button>
            </div>
        </div>
    );
};


const IncomingCallModal: React.FC<{
    fromId: string;
    onAccept: () => void;
    onDecline: () => void;
}> = ({ fromId, onAccept, onDecline }) => (
    <div className="call-modal-overlay">
        <div className="call-modal">
            <h3>Входящий вызов</h3>
            <p>от <span>{fromId.substring(0, 12)}...</span></p>
            <div className="call-modal-actions">
                <button onClick={onDecline} className="btn-decline">Отклонить</button>
                <button onClick={onAccept}>Принять</button>
            </div>
        </div>
    </div>
);

const ChatView: React.FC<{
    myId: string;
    contactId: string;
    messages: PrivateMessage[];
    onSendMessage: (recipientId: string, text: string) => void;
    onBack: () => void;
    onStartCall: (type: 'audio') => void;
}> = ({ myId, contactId, messages, onSendMessage, onBack, onStartCall }) => {
    const [text, setText] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.trim()) {
            onSendMessage(contactId, text.trim());
            setText('');
        }
    };

    return (
        <div className="chat-view">
            <header className="chat-view-header">
                <button onClick={onBack} className="btn-back"><BackIcon /></button>
                <div className="chat-contact-id">{contactId.substring(0, 8)}...</div>
                <div className="chat-header-actions">
                    <button onClick={() => onStartCall('audio')} className="btn-action"><AudioCallIcon /></button>
                </div>
            </header>
            <div className="messages-area">
                {messages.map(msg => (
                    <div key={msg.id} className={`message-bubble ${msg.senderId === myId ? 'local' : 'remote'}`}>
                        {msg.text}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSubmit} className="message-form">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Сообщение..."
                    autoFocus
                />
                <button type="submit">Отправить</button>
            </form>
        </div>
    );
};

const ContactsView: React.FC<{
    myId: string;
    contacts: Contact[];
    friendRequests: FriendRequest[];
    onAddContact: (id: string) => void;
    onAcceptRequest: (id: string) => void;
    onSelectChat: (id: string) => void;
}> = ({ myId, contacts, friendRequests, onAddContact, onAcceptRequest, onSelectChat }) => {
    const [addId, setAddId] = useState('');

    const handleAddSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (addId.trim() && addId.trim() !== myId) {
            onAddContact(addId.trim());
            setAddId('');
        }
    };

    return (
        <div className="contacts-view">
            <form onSubmit={handleAddSubmit} className="add-contact-form">
                <input
                    type="text"
                    value={addId}
                    onChange={e => setAddId(e.target.value)}
                    placeholder="Добавить контакт по ID"
                />
                <button type="submit">Добавить</button>
            </form>

            {friendRequests.length > 0 && (
                <div className="list-container">
                    <h3>Новые заявки</h3>
                    <div className="requests-list">
                        {friendRequests.map(req => (
                            <div key={req.fromId} className="list-item request-item">
                                <span>{req.fromId.substring(0, 12)}...</span>
                                <button onClick={() => onAcceptRequest(req.fromId)}>Принять</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="list-container">
                 <h3>Контакты</h3>
                <div className="contact-list">
                    {contacts.length > 0 ? contacts.map(contact => (
                        <div key={contact.id} className="list-item contact-item" onClick={() => onSelectChat(contact.id)}>
                             {contact.id.substring(0, 12)}...
                        </div>
                    )) : <p className="empty-list-placeholder">У вас пока нет контактов.</p>}
                </div>
            </div>
        </div>
    );
};


const App: React.FC = () => {
    // App State
    const [view, setView] = useState<View>('contacts');
    const [myId] = useState<string>(Storage.getDeviceId());
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');
    
    // Data State
    const [contacts, setContacts] = useState<Contact[]>(Storage.getContacts());
    const [friendRequests, setFriendRequests] = useState<FriendRequest[]>(Storage.getFriendRequests());
    const [messages, setMessages] = useState<Record<string, PrivateMessage[]>>(Storage.getMessages());
    const [activeChatId, setActiveChatId] = useState<string | null>(null);

    // Call State
    const [callState, setCallState] = useState<CallState>('idle');
    const [callType, setCallType] = useState<CallType | null>(null);
    const [incomingCallFrom, setIncomingCallFrom] = useState<string | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    // Refs
    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<mediasoupTypes.Device | null>(null);
    const sendTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const recvTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const producersRef = useRef<Map<string, mediasoupTypes.Producer>>(new Map());
    const consumersRef = useRef<Map<string, mediasoupTypes.Consumer>>(new Map());
    
    // Ref to hold the current active chat ID to prevent stale closures in socket handlers
    const activeChatIdRef = useRef(activeChatId);
    useEffect(() => {
      activeChatIdRef.current = activeChatId;
    }, [activeChatId]);


    const getPrivateRoomName = (peerId: string) => [myId, peerId].sort().join('--');

    // --- Data Persistence Effects ---
    useEffect(() => { Storage.saveContacts(contacts); }, [contacts]);
    useEffect(() => { Storage.saveFriendRequests(friendRequests); }, [friendRequests]);
    useEffect(() => { Storage.saveMessages(messages); }, [messages]);

    // --- Main Socket.IO Effect ---
    useEffect(() => {
        const socket = io({ path: '/socket.io/' });
        socketRef.current = socket;

        const handleNewProducer = async ({ producerId, peerId }) => {
            if (!recvTransportRef.current) {
                console.error("Receive transport is not ready");
                return;
            }
            console.log(`New producer found [id: ${producerId}], consuming...`);
            socket.emit('consume', { producerId, rtpCapabilities: deviceRef.current.rtpCapabilities },
                async (consumerData) => {
                    if (consumerData.error) {
                        console.error('Failed to consume:', consumerData.error);
                        return;
                    }
                    const consumer = await recvTransportRef.current.consume(consumerData);
                    consumersRef.current.set(consumer.id, consumer);
                    const { track } = consumer;
                    setRemoteStream(prev => {
                        const newStream = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
                        if (!newStream.getTrackById(track.id)) {
                             newStream.addTrack(track);
                        }
                        return newStream;
                    });
                    socket.emit('resume', { consumerId: consumer.id });
                }
            );
        };

        socket.on('connect', () => {
            console.log('Connected, registering with ID:', myId);
            socket.emit('register', myId);
        });

        socket.on('friendRequestReceived', ({ fromId }: { fromId: string }) => {
            setContacts(prevContacts => {
                if (prevContacts.some(c => c.id === fromId)) return prevContacts;
                setFriendRequests(prevReqs => {
                    if (prevReqs.some(r => r.fromId === fromId)) return prevReqs;
                    return [...prevReqs, { fromId }];
                });
                return prevContacts;
            });
        });

        socket.on('friendRequestAccepted', ({ acceptorId }: { acceptorId: string }) => {
             setContacts(prev => prev.some(c => c.id === acceptorId) ? prev : [...prev, { id: acceptorId }]);
        });
        
        socket.on('newPrivateMessage', ({ senderId, message }: { senderId: string, message: string }) => {
            addMessage(senderId, senderId, message);
        });

        // --- Call Signaling Handlers ---
        socket.on('call-offer', ({ fromId, type }: { fromId: string, type: CallType }) => {
            setCallState(currentCallState => {
                if (currentCallState === 'idle') {
                    setIncomingCallFrom(fromId);
                    setCallType(type);
                    return 'incoming';
                } else {
                    socket.emit('call-decline', { toId: fromId, fromId: myId });
                    return currentCallState;
                }
            });
        });

        socket.on('call-accepted', async ({ fromId }: { fromId: string }) => {
            setCallState(currentCallState => {
                if (currentCallState === 'outgoing' && activeChatIdRef.current === fromId) {
                    setCallType(currentCallType => {
                        initAndStartCall(fromId, currentCallType);
                        return currentCallType;
                    });
                    return 'active';
                }
                return currentCallState;
            });
        });

        socket.on('call-declined', ({ fromId }: { fromId: string }) => {
             if (activeChatIdRef.current === fromId) {
                alert('Вызов отклонен');
                handleEndCall(false); // don't emit
            }
        });

        socket.on('call-ended', () => {
             handleEndCall(false); // don't emit
        });
        
        socket.on('new-producer', handleNewProducer);
        socket.on('producer-closed', ({ producerId }) => {
             console.log(`Producer [id: ${producerId}] closed.`);
             // Handle remote stream cleanup if necessary
        });

        socket.on('disconnect', () => console.log('Disconnected from server'));

        return () => {
            console.log("Disconnecting socket on cleanup.");
            socket.disconnect();
        };
    }, [myId]); // Stable dependency array to prevent re-connections


    const addMessage = (peerId: string, senderId: string, text: string) => {
        const newMessage: PrivateMessage = { id: `${Date.now()}`, text, senderId, timestamp: Date.now() };
        setMessages(prev => {
            const peerMessages = prev[peerId] || [];
            return { ...prev, [peerId]: [...peerMessages, newMessage] };
        });
    };
    
    // --- Contact Management Handlers ---
    const handleAddContact = (id: string) => {
        if (contacts.some(c => c.id === id)) return alert("Этот пользователь уже в ваших контактах.");
        socketRef.current?.emit('sendFriendRequest', { recipientId: id, fromId: myId });
        alert(`Заявка отправлена пользователю ${id.substring(0,8)}...`);
    };

    const handleAcceptRequest = (requesterId: string) => {
        if (!contacts.some(c => c.id === requesterId)) {
            setContacts(prev => [...prev, { id: requesterId }]);
        }
        setFriendRequests(prev => prev.filter(req => req.fromId !== requesterId));
        socketRef.current?.emit('acceptFriendRequest', { requesterId, acceptorId: myId });
    };
    
    // --- Chat Handlers ---
    const handleSendMessage = (recipientId: string, text: string) => {
        socketRef.current?.emit('privateMessage', { recipientId, senderId: myId, message: text });
        addMessage(recipientId, myId, text);
    };

    const handleSelectChat = (id: string) => {
        setActiveChatId(id);
        setView('chat');
    };
    
    const handleBackToContacts = () => {
        setActiveChatId(null);
        setView('contacts');
    };

    // --- Call Management Handlers ---
    const handleStartCall = (peerId: string, type: 'audio') => {
        if (callState !== 'idle') return alert("Завершите текущий вызов.");
        setCallState('outgoing');
        setCallType(type);
        setActiveChatId(peerId);
        socketRef.current?.emit('call-offer', { toId: peerId, fromId: myId, type });
    };
    
    const handleAcceptCall = async () => {
        if (!incomingCallFrom) return;
        setCallState('active');
        setActiveChatId(incomingCallFrom);
        setView('chat'); // Switch to chat view behind the call
        socketRef.current?.emit('call-accept', { toId: incomingCallFrom, fromId: myId });
        await initAndStartCall(incomingCallFrom, callType);
    };

    const handleDeclineCall = () => {
        if (!incomingCallFrom) return;
        socketRef.current?.emit('call-decline', { toId: incomingCallFrom, fromId: myId });
        setCallState('idle');
        setIncomingCallFrom(null);
        setCallType(null);
    };

    const handleEndCall = (emitEvent = true) => {
        if (emitEvent && activeChatIdRef.current) {
            socketRef.current?.emit('call-end', { toId: activeChatIdRef.current, fromId: myId });
        }
        
        localStream?.getTracks().forEach(track => track.stop());
        setLocalStream(null);
        setRemoteStream(null);

        producersRef.current.forEach(p => p.close());
        producersRef.current.clear();
        consumersRef.current.forEach(c => c.close());
        consumersRef.current.clear();
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();
        
        setCallState('idle');
        setIncomingCallFrom(null);
        setCallType(null);
        // Do not reset activeChatId, to stay in the chat view
    };


    // --- Mediasoup Logic ---
    const initAndStartCall = async (peerId: string, type: CallType) => {
        const roomName = getPrivateRoomName(peerId);
        try {
            // 1. Get Router Capabilities
            socketRef.current.emit('getRouterRtpCapabilities', { roomName }, async (routerRtpCapabilities) => {
                // 2. Create Device
                const device = new mediasoupClient.Device();
                await device.load({ routerRtpCapabilities });
                deviceRef.current = device;

                // 3. Join Room
                socketRef.current.emit('joinRoom', { roomName });
                
                // 4. Create Transports
                await createTransports(roomName);
                
                // 5. Start Media and Produce
                await startMediaAndProduce(type);
            });
        } catch (error) {
            console.error("Call initialization failed:", error);
            handleEndCall();
        }
    };
    
    const createTransports = async (roomName: string) => {
        return new Promise<void>((resolve, reject) => {
            const createTransport = (isSender: boolean, callback: (transport: mediasoupTypes.Transport) => void) => {
                 socketRef.current.emit('createWebRtcTransport', { isSender }, (params) => {
                    if (params.error) return reject(new Error(params.error));
                    
                    const transport = isSender
                        ? deviceRef.current.createSendTransport(params)
                        : deviceRef.current.createRecvTransport(params);

                    transport.on('connect', ({ dtlsParameters }, cb, eb) => {
                        socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, () => cb());
                    });

                    if (isSender) {
                        transport.on('produce', async ({ kind, rtpParameters, appData }, cb, eb) => {
                            socketRef.current.emit('produce', { transportId: transport.id, kind, rtpParameters, appData }, ({ id }) => {
                                cb({ id });
                            });
                        });
                    }
                    callback(transport);
                });
            };

            createTransport(true, (transport) => {
                sendTransportRef.current = transport;
                createTransport(false, (transport) => {
                    recvTransportRef.current = transport;
                    resolve();
                });
            });
        });
    };
    
    const startMediaAndProduce = async (type: CallType) => {
        if (!sendTransportRef.current) return;
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            setLocalStream(stream);
            
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                const audioProducer = await sendTransportRef.current.produce({ track: audioTrack });
                producersRef.current.set(audioProducer.id, audioProducer);
            }
        } catch (error) {
            console.error("Error getting user media:", error);
            alert("Не удалось получить доступ к микрофону. Проверьте разрешения.");
            handleEndCall();
        }
    };

    // --- Clipboard ---
    const copyToClipboard = () => {
        navigator.clipboard.writeText(myId).then(() => {
            setCopySuccess('Скопировано!');
            setTimeout(() => setCopySuccess(''), 2000);
        }, () => setCopySuccess('Ошибка'));
    };

    return (
        <div className="app-container">
            {callState === 'active' && activeChatId && <CallView myId={myId} peerId={activeChatId} onHangUp={() => handleEndCall(true)} localStream={localStream} remoteStream={remoteStream} />}
            {callState === 'incoming' && incomingCallFrom && <IncomingCallModal fromId={incomingCallFrom} onAccept={handleAcceptCall} onDecline={handleDeclineCall} />}
            {callState === 'outgoing' && <div className="call-modal-overlay"><div className="call-modal"><h3>Исходящий вызов...</h3><button onClick={() => handleEndCall(true)}>Отмена</button></div></div>}


            <div className="main-ui" style={{ display: callState === 'active' ? 'none' : 'flex' }}>
                 <header className="header">
                     <div className="header-menu">
                         <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="btn-menu" aria-label="Меню"><MoreVertIcon /></button>
                        {isMenuOpen && (
                            <div className="dropdown-menu">
                                <div className="device-id-section">
                                    <span>Ваш ID для добавления:</span>
                                    <div className="id-container">
                                        <span className="device-id">{myId}</span>
                                        <button onClick={copyToClipboard} className="btn-copy" aria-label="Копировать ID">{copySuccess ? <span>{copySuccess}</span> : <CopyIcon />}</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </header>

                <main className="main-content-area">
                    {view === 'contacts' && (
                        <ContactsView
                            myId={myId}
                            contacts={contacts}
                            friendRequests={friendRequests}
                            onAddContact={handleAddContact}
                            onAcceptRequest={handleAcceptRequest}
                            onSelectChat={handleSelectChat}
                        />
                    )}
                    {view === 'chat' && activeChatId && (
                        <ChatView
                            myId={myId}
                            contactId={activeChatId}
                            messages={messages[activeChatId] || []}
                            onSendMessage={handleSendMessage}
                            onBack={handleBackToContacts}
                            onStartCall={(type) => handleStartCall(activeChatId, type)}
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}