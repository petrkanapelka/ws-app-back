import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { v1 } from 'uuid';

type User = {
    id: string;
    name: string;
};

type Message = {
    id: string;
    message: string;
    user: User;
};

const users = new Map();

const messages: Message[] = [{ message: 'Hello, Victor', id: '23f2332', user: { id: v1(), name: 'Robert' } }];

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
});

io.on('connection', (socketChannel) => {
    console.log('a user connected');

    users.set(socketChannel, { id: v1(), name: 'anonym' });

    socketChannel.on('client-name-sent', (name: string) => {
        const user: User = users.get(socketChannel);
        user.name = name;
    });

    socketChannel.on('client-message-sent', (message: string) => {
        const user: User = users.get(socketChannel);

        let messageItem: Message = {
            message,
            id: v1(),
            user,
        };
        messages.push(messageItem);

        io.emit('new-message-sent', messageItem);

        console.log(message);
    });

    socketChannel.on('user-typed', () => {
        const user: User = users.get(socketChannel);
        io.emit('user-typing', user);
    });

    socketChannel.on('user-stop-typed', () => {
        const user: User = users.get(socketChannel);
        io.emit('user-stop-typing', user);
    });

    socketChannel.emit('init-messages-published', messages);

    socketChannel.on('disconnect', () => {
        console.log('user disconnected');
        users.delete(socketChannel);
    });
});

server.listen(3010, () => {
    console.log('server running at http://localhost:3010');
});
