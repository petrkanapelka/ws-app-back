import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';

type User = {
    id: string;
    name: string;
};

type Message = {
    id: string;
    message: string;
    user: User;
};

const messages: Message[] = [
    { message: 'Hello, Viktor', id: '23f2332', user: { id: 'sddsdsfds', name: 'Dimych' } },
    { message: 'Hello, Dimych', id: '23fd32c23', user: { id: 'eefw2', name: 'Viktor' } },
    { message: 'Hello, Petrovich', id: '23fd32c23', user: { id: 'eefw2', name: 'Petro' } },
    { message: 'Hello, Viktor', id: '23f2332', user: { id: 'sddsdsfds', name: 'Dimych' } },
    { message: 'Hello, Dimych', id: '23fd32c23', user: { id: 'eefw2', name: 'Viktor' } },
    { message: 'Hello, Petrovich', id: '23fd32c23', user: { id: 'eefw2', name: 'Petro' } },
];

const app = express();
const server = createServer(app);

const io = new Server(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
    },
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
    res.send('Hello, It`s a WS server');
    // res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', (socketChannel) => {
    console.log('a user connected');
    socketChannel.on('client-message-sent', (message: string) => {
        console.log(message);
    });

    socketChannel.emit('init-messages-published', messages);
});

server.listen(3010, () => {
    console.log('server running at http://localhost:3010');
});
