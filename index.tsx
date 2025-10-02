
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
        // This is the fix for the echo: attach the local stream to a muted audio element.
        // This tells the browser we are handling the stream, preventing it from
        // auto-playing it through the speakers.
        if (localAudioRef.current && localStream) {
            localAudioRef.current.srcObject = localStream;
            // Explicitly play muted stream, good practice for some browsers.
            localAudioRef.current.play().catch(e => console.warn("Local muted audio play failed, this is usually fine", e));
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteAudioRef.current && remoteStream) {
            remoteAudioRef.current.srcObject = remoteStream;
            // This is the fix for the "no sound" bug: explicitly call play()
            // to overcome strict browser autoplay policies.
            remoteAudioRef.current.play().catch(error => {
                console.error("Remote audio playback failed:", error);
            });
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
            
            {/* Hidden, muted audio element for local stream to prevent echo */}
            <audio ref={localAudioRef} autoPlay playsInline muted />
            {/* Visible (but hidden by CSS) audio element for remote stream */}
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
    const [activeChatId, setActiveChatId] = useState<string | null>(null);

    // Data State
    const [contacts, setContacts] = useState<Contact[]>(Storage.getContacts());
    const [friendRequests, setFriendRequests] = useState<FriendRequest[]>(Storage.getFriendRequests());
    const [messages, setMessages] = useState<Record<string, PrivateMessage[]>>(Storage.getMessages());

    // Call State
    const [callState, setCallState] = useState<CallState>('idle');
    const [activeCallPeerId, setActiveCallPeerId] = useState<string | null>(null);
    const [incomingCallFromId, setIncomingCallFromId] = useState<string | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    // Refs
    const socketRef = useRef<Socket | null>(null);
    const deviceRef = useRef<mediasoupTypes.Device | null>(null);
    const sendTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const recvTransportRef = useRef<mediasoupTypes.Transport | null>(null);
    const producerRef = useRef<mediasoupTypes.Producer | null>(null);
    const consumersRef = useRef<Map<string, mediasoupTypes.Consumer>>(new Map());

    // --- Main Connection Effect ---
    useEffect(() => {
        const socket = io({ path: '/socket.io/' });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Connected, registering with ID:', myId);
            socket.emit('register', myId);
        });
        
        socket.on('disconnect', () => console.log('Disconnected from server'));

        // --- Event Listeners ---
        socket.on('friendRequestReceived', ({ fromId }: { fromId: string }) => {
            setFriendRequests(prev => {
                if (prev.some(req => req.fromId === fromId)) return prev;
                const newRequests = [...prev, { fromId }];
                Storage.saveFriendRequests(newRequests);
                return newRequests;
            });
        });

        socket.on('friendRequestAccepted', ({ acceptorId }: { acceptorId: string }) => {
            setContacts(prev => {
                if (prev.some(c => c.id === acceptorId)) return prev;
                const newContacts = [...prev, { id: acceptorId }];
                Storage.saveContacts(newContacts);
                return newContacts;
            });
        });
        
        socket.on('newPrivateMessage', ({ senderId, message }: { senderId: string, message: PrivateMessage }) => {
            setMessages(prev => {
                const newMessages = { ...prev };
                if (!newMessages[senderId]) newMessages[senderId] = [];
                newMessages[senderId] = [...newMessages[senderId], message];
                Storage.saveMessages(newMessages);
                return newMessages;
            });
        });

        // --- Call Signaling Listeners ---
        socket.on('call-offer', ({ fromId, type }: { fromId: string, type: CallType }) => {
            // Only accept calls if idle
            if (callState === 'idle') {
                setIncomingCallFromId(fromId);
                setCallState('incoming');
            }
        });

        socket.on('call-accepted', ({ fromId }: { fromId: string }) => {
            if (callState === 'outgoing' && activeCallPeerId === fromId) {
                setCallState('active');
                startMediaAndProduce();
            }
        });

        socket.on('call-declined', ({ fromId }: { fromId: string }) => {
            if (callState === 'outgoing' && activeCallPeerId === fromId) {
                alert('Вызов отклонен');
                handleEndCall();
            }
        });

        socket.on('call-ended', ({ fromId }: { fromId: string }) => {
            if (callState === 'active' && activeCallPeerId === fromId) {
                 alert('Собеседник завершил вызов');
                 handleEndCall();
            }
        });

        // Mediasoup Listeners
        socket.on('new-producer', async ({ producerId, peerId }) => {
            if (recvTransportRef.current) {
                await consumeStream(producerId);
            }
        });

        return () => {
            socket.disconnect();
        };
    }, [myId, callState, activeCallPeerId]);


    // --- Mediasoup Core Functions ---
    const joinCallRoom = async (peerId: string) => {
        const roomName = [myId, peerId].sort().join('-'); // Create a deterministic room name
        socketRef.current?.emit('joinRoom', { roomName });

        const device = new mediasoupClient.Device();
        deviceRef.current = device;
        
        const routerRtpCapabilities = await new Promise<mediasoupTypes.RtpCapabilities>(resolve => {
            socketRef.current?.emit('getRouterRtpCapabilities', { roomName }, resolve);
        });
        
        await device.load({ routerRtpCapabilities });
        
        // Create send transport
        const sendTransportParams = await new Promise<any>(resolve => {
            socketRef.current?.emit('createWebRtcTransport', { isSender: true }, resolve);
        });
        const sendTransport = device.createSendTransport(sendTransportParams);
        sendTransportRef.current = sendTransport;
        
        sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            socketRef.current?.emit('connectTransport', { transportId: sendTransport.id, dtlsParameters }, () => callback());
        });
        sendTransport.on('produce', (parameters, callback, errback) => {
             socketRef.current?.emit('produce', {
                transportId: sendTransport.id,
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
            }, ({ id }) => callback({ id }));
        });

        // Create receive transport
        const recvTransportParams = await new Promise<any>(resolve => {
            socketRef.current?.emit('createWebRtcTransport', { isSender: false }, resolve);
        });
        const recvTransport = device.createRecvTransport(recvTransportParams);
        recvTransportRef.current = recvTransport;
        
        recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            socketRef.current?.emit('connectTransport', { transportId: recvTransport.id, dtlsParameters }, () => callback());
        });
    };

    const startMediaAndProduce = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }, 
                video: false 
            });
            setLocalStream(stream);
            
            const track = stream.getAudioTracks()[0];
            const producer = await sendTransportRef.current?.produce({ track });
            producerRef.current = producer;

        } catch (error) {
            console.error("Error getting user media:", error);
            alert('Не удалось получить доступ к микрофону.');
            handleEndCall();
        }
    };
    
    const consumeStream = async (producerId: string) => {
        if (!deviceRef.current) return;
        
        const { rtpCapabilities } = deviceRef.current;
        const data = await new Promise<any>(resolve => {
            socketRef.current?.emit('consume', { producerId, rtpCapabilities }, resolve);
        });

        if (data.error) return console.error('Consume error:', data.error);
        
        const consumer = await recvTransportRef.current?.consume(data);
        if (!consumer) return;

        consumersRef.current.set(consumer.id, consumer);
        
        const stream = new MediaStream();
        stream.addTrack(consumer.track);
        setRemoteStream(stream);

        socketRef.current?.emit('resume', { consumerId: consumer.id });
    };


    // --- UI Handlers ---
    const handleAddContact = (id: string) => {
        socketRef.current?.emit('sendFriendRequest', { recipientId: id, fromId: myId });
        alert(`Заявка отправлена пользователю ${id.substring(0, 8)}...`);
    };

    const handleAcceptRequest = (requesterId: string) => {
        socketRef.current?.emit('acceptFriendRequest', { requesterId, acceptorId: myId });
        setContacts(prev => {
            const newContacts = [...prev, { id: requesterId }];
            Storage.saveContacts(newContacts);
            return newContacts;
        });
        setFriendRequests(prev => {
            const newRequests = prev.filter(req => req.fromId !== requesterId);
            Storage.saveFriendRequests(newRequests);
            return newRequests;
        });
    };
    
    const handleSendMessage = (recipientId: string, text: string) => {
        const message: PrivateMessage = {
            id: crypto.randomUUID(),
            text,
            senderId: myId,
            timestamp: Date.now()
        };
        setMessages(prev => {
            const newMessages = { ...prev };
            if (!newMessages[recipientId]) newMessages[recipientId] = [];
            newMessages[recipientId] = [...newMessages[recipientId], message];
            Storage.saveMessages(newMessages);
            return newMessages;
        });
        socketRef.current?.emit('privateMessage', { recipientId, senderId: myId, message });
    };
    
    const handleSelectChat = (id: string) => {
        setActiveChatId(id);
        setView('chat');
    };
    
    const handleBackToContacts = () => {
        setActiveChatId(null);
        setView('contacts');
    };

    // --- Call Handlers ---
    const handleStartCall = (peerId: string) => {
        setActiveCallPeerId(peerId);
        setCallState('outgoing');
        socketRef.current?.emit('call-offer', { toId: peerId, fromId: myId, type: 'audio' });
        joinCallRoom(peerId);
    };

    const handleAcceptCall = () => {
        if (!incomingCallFromId) return;
        setActiveCallPeerId(incomingCallFromId);
        setCallState('active');
        socketRef.current?.emit('call-accept', { toId: incomingCallFromId, fromId: myId });
        setIncomingCallFromId(null);
        joinCallRoom(incomingCallFromId);
        startMediaAndProduce();
    };

    const handleDeclineCall = () => {
        if (incomingCallFromId) {
            socketRef.current?.emit('call-decline', { toId: incomingCallFromId, fromId: myId });
        }
        setIncomingCallFromId(null);
        setCallState('idle');
    };

    const handleEndCall = () => {
        if (activeCallPeerId) {
            socketRef.current?.emit('call-end', { toId: activeCallPeerId, fromId: myId });
        }
        
        localStream?.getTracks().forEach(track => track.stop());
        producerRef.current?.close();
        sendTransportRef.current?.close();
        recvTransportRef.current?.close();
        
        setLocalStream(null);
        setRemoteStream(null);
        setActiveCallPeerId(null);
        setCallState('idle');
        setIncomingCallFromId(null);

        producerRef.current = null;
        sendTransportRef.current = null;
        recvTransportRef.current = null;
        deviceRef.current = null;
        consumersRef.current.clear();
    };


    // --- Render Logic ---
    const renderView = () => {
        switch(view) {
            case 'chat':
                return activeChatId && (
                    <ChatView
                        myId={myId}
                        contactId={activeChatId}
                        messages={messages[activeChatId] || []}
                        onSendMessage={handleSendMessage}
                        onBack={handleBackToContacts}
                        onStartCall={() => handleStartCall(activeChatId)}
                    />
                );
            case 'contacts':
            default:
                return (
                    <ContactsView
                        myId={myId}
                        contacts={contacts}
                        friendRequests={friendRequests}
                        onAddContact={handleAddContact}
                        onAcceptRequest={handleAcceptRequest}
                        onSelectChat={handleSelectChat}
                    />
                );
        }
    };
    
    return (
        <div className="app-container">
            <div className={`main-ui ${callState !== 'idle' ? 'hidden' : ''}`}>
                 <header className="header">
                    <div className="header-menu">
                        <button className="btn-menu" onClick={() => setIsMenuOpen(!isMenuOpen)}>
                            <MoreVertIcon />
                        </button>
                        {isMenuOpen && (
                            <div className="dropdown-menu">
                                <div className="device-id-section">
                                    <span>Ваш уникальный ID:</span>
                                    <div className="id-container">
                                        <span className="device-id">{myId}</span>
                                        <button className="btn-copy" onClick={() => navigator.clipboard.writeText(myId)}>
                                            <CopyIcon />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </header>
                <main className="main-content-area">
                    {renderView()}
                </main>
            </div>

            {/* Call UI Overlays */}
            {callState === 'incoming' && incomingCallFromId && (
                <IncomingCallModal 
                    fromId={incomingCallFromId}
                    onAccept={handleAcceptCall}
                    onDecline={handleDeclineCall}
                />
            )}
             {callState === 'outgoing' && activeCallPeerId && (
                <div className="call-modal-overlay">
                    <div className="call-modal">
                        <h3>Исходящий вызов</h3>
                        <p><span>{activeCallPeerId.substring(0, 12)}...</span></p>
                        <button onClick={handleEndCall} className="btn-decline">Отменить</button>
                    </div>
                </div>
            )}
            {callState === 'active' && activeCallPeerId && (
                <CallView
                    myId={myId}
                    peerId={activeCallPeerId}
                    onHangUp={handleEndCall}
                    localStream={localStream}
                    remoteStream={remoteStream}
                />
            )}
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
