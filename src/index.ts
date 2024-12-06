import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt, { JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';
import winston from 'winston';
import { v1 } from 'uuid';

const PORT: string | number = process.env.PORT || 3010;
const JWT_SECRET: string = 'your_secret_key';
const SALT_ROUNDS: number = 10;

interface UserBase {
    id: string;
    name: string;
    email?: string;
}

export interface User extends UserBase {}

interface RegisteredUser extends UserBase {
    passwordHash: string;
    token?: string;
}

interface Message {
    message: string;
    id: string;
    user: User;
}

const users: Map<Socket, User> = new Map();
const registeredUsers: Map<string, RegisteredUser> = new Map();
const loginUsers: Map<string, RegisteredUser> = new Map();
const messages: Message[] = [{ message: 'Welcome to RapidChat', id: '666', user: { id: v1(), name: 'RapidChat' } }];

const app = express();

app.use(express.json());

app.use(
    cors({
        origin: '*',
        methods: ['GET', 'POST'],
    })
);

const server = createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: 'server.log' })],
});

export interface AuthenticatedRequest extends Request {
    user?: User;
}

app.post('/register', async (req: Request, res: Response): Promise<void> => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        res.status(400).send({ messageError: 'Email, password, and name are required' });
    }

    if (registeredUsers.has(email)) {
        res.status(400).send({ messageError: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    registeredUsers.set(email, {
        id: v1(),
        name,
        email,
        passwordHash,
    });

    logger.info(`User registered: ${email}`);
    res.status(201).send({ message: 'User registered successfully', name });
});

app.post('/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    const user = registeredUsers.get(email);

    if (!user) {
        res.status(400).send({ messageError: 'Invalid email or password' });
        return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
        res.status(400).send({ messageError: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });

    user.token = token;

    loginUsers.set(token, user);

    logger.info(`User logged in: ${email}`);
    res.json({ token, name: user.name });
});

app.post('/profile', async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;

    const user = loginUsers.get(token);

    if (user) {
        res.json({ token, name: user.name });
    }
});

app.post('/logout', async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;

    loginUsers.delete(token);
});

io.on('connection', (socket: Socket) => {
    console.log('user connected');
    logger.info('user connected');

    socket.on('client-auth', (token: string) => {
        console.log('Client-auth event received with token:', token);
        const loginUser = loginUsers.get(token);

        if (loginUser) {
            console.log('User authenticated:', loginUser);
            const user: User = { id: loginUser.id, name: loginUser.name, email: loginUser.email };
            users.set(socket, user);
            socket.emit('auth-success', 'Authentication successful');
        } else {
            console.log('Invalid token:', token);
            socket.emit('auth-error', 'Authentication failed');
            socket.disconnect();
        }
    });

    socket.on('client-message-sent', (message: string) => {
        if (typeof message !== 'string' || message.trim().length === 0) {
            socket.emit('error-message', 'Invalid message. Message cannot be empty.');
            return;
        }

        if (message.trim().length > 100) {
            socket.emit('error-message', 'Invalid message. Message cannot be longer than 100 characters.');
            return;
        }

        const user = users.get(socket);

        if (!user) {
            socket.emit('error-message', 'User not found.');
            return;
        }

        const messageItem: Message = {
            message: message.trim(),
            id: v1(),
            user,
        };

        messages.push(messageItem);
        if (messages.length > 100) {
            messages.shift();
        }
        io.emit('new-message-sent', messageItem);
        logger.info(`Message from ${user.name}: ${message}`);
    });

    socket.on('client-name-sent', (name: string) => {
        if (typeof name !== 'string' || name.trim().length === 0) {
            socket.emit('error-message', 'Invalid name. Name cannot be empty.');
            return;
        }

        if (name.trim().length > 10) {
            socket.emit('error-message', 'Invalid name. Name cannot be longer than 10 characters.');
            return;
        }

        const user = users.get(socket);
        if (!user) {
            socket.emit('error-message', 'User not found.');
            return;
        }

        user.name = name;

        const registeredUser = registeredUsers.get(user.email!);

        if (registeredUser) {
            registeredUser.name = name;
            const loginUser = loginUsers.get(registeredUser.token!);
            if (loginUser) {
                loginUser.name = name;
            }
        }

        io.emit('client-name-sent', name);
        logger.info(`New name ${user.name}: ${name}`);
    });

    socket.on('user-typed', () => {
        const user = users.get(socket);
        if (user) {
            io.emit('user-typing', user);
        }
    });

    socket.on('user-stop-typed', () => {
        const user = users.get(socket);
        if (user) {
            io.emit('user-stop-typing', user);
        }
    });

    socket.emit('init-messages-published', messages);

    socket.on('disconnect', () => {
        console.log('User disconnected');
        logger.info('User disconnected');
        users.delete(socket);
    });
});

process.on('uncaughtException', (err: Error) => {
    logger.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection:', reason);
});

server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    console.log(`Server running on port ${PORT}`);
});
