import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Server, Socket } from 'socket.io';
import jwt, { JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cors from 'cors';
import winston from 'winston';
import { v1 } from 'uuid';

const PORT: string | number = process.env.PORT || 3010;
export const JWT_SECRET: string = process.env.JWT_SECRET || 'your_secret_key';
export const SALT_ROUNDS: number = 10;

interface RegisteredUser {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
}

export interface User {
    id: string;
    name: string;
    email?: string;
}

interface Message {
    message: string;
    id: string;
    user: User;
}

const users: Map<Socket, User> = new Map();

export const registeredUsers: Map<string, RegisteredUser> = new Map();

const messages: Message[] = [{ message: 'Welcome to RapidChat', id: '666', user: { id: v1(), name: 'RapidChat' } }];

export const app = express();

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

const __dirname = dirname(fileURLToPath(import.meta.url));

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console(), new winston.transports.File({ filename: 'server.log' })],
});

export interface AuthenticatedRequest extends Request {
    user?: User;
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        res.status(401).send('Access Denied');
        return;
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            res.status(403).send('Invalid Token');
            return;
        }
        req.user = user as User;
        next();
    });
}

app.post('/register', async (req: Request, res: Response): Promise<void> => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        res.status(400).send({ messageError: 'Email, password, and name are required' });
        return;
    }

    if (registeredUsers.has(email)) {
        res.status(400).send({ messageError: 'User already exists' });
        return;
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
        return;
    }

    const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
    logger.info(`User logged in: ${email}`);
    res.json({ token, name: user.name });

    io.on('connection', (socketChannel: Socket) => {
        console.log('user connected');
        logger.info('user connected');

        users.set(socketChannel, { id: v1(), name: user.name, email: user.email });

        socketChannel.on('client-auth', (token: string) => {
            jwt.verify(token, JWT_SECRET, (err, user) => {
                if (err) {
                    socketChannel.emit('error-message', 'Authentication failed');
                    logger.warn('Authentication failed');
                    return;
                }

                const existingUser = users.get(socketChannel);
                if (existingUser) {
                    existingUser.id = (user as User).id;
                    existingUser.name = (user as User).name;
                    logger.info(`User authenticated: ${existingUser.name}`);
                }
            });
        });

        socketChannel.on('client-message-sent', (message: string) => {
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

        socketChannel.on('client-name-sent', (name: string) => {
            if (typeof name !== 'string' || name.trim().length === 0) {
                socketChannel.emit('error-message', 'Invalid name. Name cannot be empty.');
                return;
            }
            if (name.trim().length > 10) {
                socketChannel.emit('error-message', 'Invalid name. Name cannot be longer than 10 characters.');
                return;
            }

            const user = users.get(socketChannel);
            const registerUser = registeredUsers.get(user?.email!);

            if (!user) {
                socketChannel.emit('error-message', 'User not found.');
                return;
            }

            user.name = name;

            if (registerUser) {
                registerUser.name = name;
            }

            io.emit('client-name-sent', name);
            logger.info(`New name ${user.name}: ${name}`);
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
            logger.info('User disconnected');
            users.delete(socketChannel);
        });
    });
});

// app.get('/profile', authenticateToken, (req: AuthenticatedRequest, res: Response): void => {
//     res.json({ user: req.user });
// });

// io.on('connection', (socketChannel: Socket) => {
//     console.log('user connected');
//     logger.info('user connected');

//     users.set(socketChannel, { id: v1(), name: 'anonym' });

//     socketChannel.on('client-auth', (token: string) => {
//         jwt.verify(token, JWT_SECRET, (err, user) => {
//             if (err) {
//                 socketChannel.emit('error-message', 'Authentication failed');
//                 logger.warn('Authentication failed');
//                 return;
//             }

//             const existingUser = users.get(socketChannel);
//             if (existingUser) {
//                 existingUser.id = (user as User).id;
//                 existingUser.name = (user as User).name;
//                 logger.info(`User authenticated: ${existingUser.name}`);
//             }
//         });
//     });

//     socketChannel.on('client-message-sent', (message: string) => {
//         if (typeof message !== 'string' || message.trim().length === 0) {
//             socketChannel.emit('error-message', 'Invalid message. Message cannot be empty.');
//             return;
//         }
//         if (message.trim().length > 100) {
//             socketChannel.emit('error-message', 'Invalid message. Message cannot be longer than 100 characters.');
//             return;
//         }

//         const user = users.get(socketChannel);

//         if (!user) {
//             socketChannel.emit('error-message', 'User not found.');
//             return;
//         }

//         const messageItem: Message = {
//             message: message.trim(),
//             id: v1(),
//             user,
//         };

//         messages.push(messageItem);
//         if (messages.length > 100) {
//             messages.shift();
//         }
//         io.emit('new-message-sent', messageItem);
//         logger.info(`Message from ${user.name}: ${message}`);
//     });

//     socketChannel.on('client-name-sent', (name: string) => {
//         if (typeof name !== 'string' || name.trim().length === 0) {
//             socketChannel.emit('error-message', 'Invalid name. Name cannot be empty.');
//             return;
//         }
//         if (name.trim().length > 10) {
//             socketChannel.emit('error-message', 'Invalid name. Name cannot be longer than 10 characters.');
//             return;
//         }

//         const user = users.get(socketChannel);

//         if (!user) {
//             socketChannel.emit('error-message', 'User not found.');
//             return;
//         }

//         user.name = name;

//         io.emit('client-name-sent', name);
//         logger.info(`New name ${user.name}: ${name}`);
//     });

//     socketChannel.on('user-typed', () => {
//         const user = users.get(socketChannel);
//         if (user) {
//             io.emit('user-typing', user);
//         }
//     });

//     socketChannel.on('user-stop-typed', () => {
//         const user = users.get(socketChannel);
//         if (user) {
//             io.emit('user-stop-typing', user);
//         }
//     });

//     socketChannel.emit('init-messages-published', messages);

//     socketChannel.on('disconnect', () => {
//         console.log('User disconnected');
//         logger.info('User disconnected');
//         users.delete(socketChannel);
//     });
// });

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
