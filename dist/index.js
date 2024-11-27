import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Server } from 'socket.io';
import { v1 } from 'uuid';
const PORT = process.env.PORT || 3010;
const users = new Map();
const messages = [{ message: 'Welcome to RapidChat', id: '666', user: { id: v1(), name: 'RapidChat' } }];
const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
    },
});
const __dirname = dirname(fileURLToPath(import.meta.url));
app.get('/', (req, res) => {
    res.send('Hello, It`s a WS server');
});
io.on('connection', (socketChannel) => {
    console.log('A user connected');
    users.set(socketChannel, { id: v1(), name: 'anonym' });
    socketChannel.on('client-name-sent', (name) => {
        if (typeof name !== 'string' || name.trim().length < 2) {
            socketChannel.emit('error-message', 'Invalid name. Name must be at least 2 characters long.');
            return;
        }
        if (name.trim().length > 20) {
            socketChannel.emit('error-message', 'Invalid name. Name cannot be longer than 20 characters.');
            return;
        }
        const user = users.get(socketChannel);
        user.name = name.trim();
    });
    socketChannel.on('client-message-sent', (message) => {
        if (typeof message !== 'string' || message.trim().length === 0) {
            socketChannel.emit('error-message', 'Invalid message. Message cannot be empty.');
            return;
        }
        if (message.trim().length > 100) {
            socketChannel.emit('error-message', 'Invalid message. Message cannot be longer than 100 characters.');
            return;
        }
        const user = users.get(socketChannel);
        if (!user) {
            socketChannel.emit('error-message', 'User not found.');
            return;
        }
        try {
            const messageItem = {
                message: message.trim(),
                id: v1(),
                user,
            };
            messages.push(messageItem);
            io.emit('new-message-sent', messageItem);
            console.log(`Message from ${user.name}: ${message}`);
        }
        catch (error) {
            console.error('Error processing message:', error);
            socketChannel.emit('error-message', 'Failed to send the message.');
        }
    });
    socketChannel.on('user-typed', () => {
        const user = users.get(socketChannel);
        if (user) {
            io.emit('user-typing', user);
        }
    });
    socketChannel.on('user-stop-typed', () => {
        const user = users.get(socketChannel);
        if (user) {
            io.emit('user-stop-typing', user);
        }
    });
    socketChannel.emit('init-messages-published', messages);
    socketChannel.on('disconnect', () => {
        console.log('User disconnected');
        users.delete(socketChannel);
    });
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
