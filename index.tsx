import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';

// --- Types ---
type View = 'contacts' | 'chat';

type Contact = {
    id: string;
};

type FriendRequest = {
    fromId: string;
};

type PrivateMessage = {
    id: string; // Unique message ID
    text: string;
    senderId: string; // "me" or peerId
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

// --- Components ---

const ChatView: React.FC<{
    myId: string;
    contactId: string;
    messages: PrivateMessage[];
    onSendMessage: (recipientId: string, text: string) => void;
    onBack: () => void;
}> = ({ myId, contactId, messages, onSendMessage, onBack }) => {
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
    const [view, setView] = useState<View>('contacts');
    const [myId] = useState<string>(Storage.getDeviceId());
    const [contacts, setContacts] = useState<Contact[]>(Storage.getContacts());
    const [friendRequests, setFriendRequests] = useState<FriendRequest[]>(Storage.getFriendRequests());
    const [messages, setMessages] = useState<Record<string, PrivateMessage[]>>(Storage.getMessages());
    const [activeChatId, setActiveChatId] = useState<string | null>(null);

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');
    
    const socketRef = useRef<Socket | null>(null);

    // Effect for saving data to localStorage
    useEffect(() => {
        Storage.saveContacts(contacts);
    }, [contacts]);

    useEffect(() => {
        Storage.saveFriendRequests(friendRequests);
    }, [friendRequests]);
    
    useEffect(() => {
        Storage.saveMessages(messages);
    }, [messages]);

    // Effect for Socket.IO connection and event listeners
    useEffect(() => {
        const socket = io({ path: '/socket.io/' });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Connected to server, registering with ID:', myId);
            socket.emit('register', myId);
        });

        socket.on('friendRequestReceived', ({ fromId }: { fromId: string }) => {
            // Avoid adding duplicate requests or requests from existing contacts
            if (!contacts.some(c => c.id === fromId) && !friendRequests.some(r => r.fromId === fromId)) {
                console.log('Received friend request from:', fromId);
                setFriendRequests(prev => [...prev, { fromId }]);
            }
        });

        socket.on('friendRequestAccepted', ({ acceptorId }: { acceptorId: string }) => {
             console.log(`Friend request accepted by: ${acceptorId}`);
             if (!contacts.some(c => c.id === acceptorId)) {
                 setContacts(prev => [...prev, { id: acceptorId }]);
             }
        });
        
        socket.on('newPrivateMessage', ({ senderId, message }: { senderId: string, message: string }) => {
            console.log(`New message from ${senderId}`);
            addMessage(senderId, senderId, message);
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        return () => {
            socket.disconnect();
        };
    }, [myId, contacts, friendRequests]); // Rerun if these change to have fresh closures

    const addMessage = (peerId: string, senderId: string, text: string) => {
        const newMessage: PrivateMessage = {
            id: `${Date.now()}`,
            text,
            senderId,
            timestamp: Date.now()
        };
        setMessages(prev => {
            const peerMessages = prev[peerId] || [];
            return {
                ...prev,
                [peerId]: [...peerMessages, newMessage]
            };
        });
    };
    
    const handleAddContact = (id: string) => {
        if (contacts.some(c => c.id === id)) {
            alert("Этот пользователь уже в ваших контактах.");
            return;
        }
        if (socketRef.current) {
            console.log(`Sending friend request to ${id}`);
            socketRef.current.emit('sendFriendRequest', { recipientId: id, fromId: myId });
            alert(`Заявка отправлена пользователю ${id.substring(0,8)}...`);
        }
    };

    const handleAcceptRequest = (requesterId: string) => {
        // Add to contacts
        if (!contacts.some(c => c.id === requesterId)) {
            setContacts(prev => [...prev, { id: requesterId }]);
        }
        // Remove from requests
        setFriendRequests(prev => prev.filter(req => req.fromId !== requesterId));
        // Notify server
        if (socketRef.current) {
            socketRef.current.emit('acceptFriendRequest', { requesterId, acceptorId: myId });
        }
    };
    
    const handleSendMessage = (recipientId: string, text: string) => {
        if(socketRef.current) {
            socketRef.current.emit('privateMessage', { recipientId, senderId: myId, message: text });
            addMessage(recipientId, myId, text);
        }
    };

    const handleSelectChat = (id: string) => {
        setActiveChatId(id);
        setView('chat');
    };
    
    const handleBackToContacts = () => {
        setActiveChatId(null);
        setView('contacts');
    };

    const copyToClipboard = () => {
        if (!myId) return;
        navigator.clipboard.writeText(myId).then(() => {
            setCopySuccess('Скопировано!');
            setTimeout(() => setCopySuccess(''), 2000);
        }, () => setCopySuccess('Ошибка'));
    };

    return (
        <div className="app-container">
            <header className="header">
                 <div className="header-menu">
                     <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="btn-menu" aria-label="Меню">
                        <MoreVertIcon />
                    </button>
                    {isMenuOpen && (
                        <div className="dropdown-menu">
                            <div className="device-id-section">
                                <span>Ваш ID для добавления:</span>
                                <div className="id-container">
                                    <span className="device-id">{myId}</span>
                                    <button onClick={copyToClipboard} className="btn-copy" aria-label="Копировать ID">
                                        {copySuccess ? <span>{copySuccess}</span> : <CopyIcon />}
                                    </button>
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
                    />
                )}
            </main>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
