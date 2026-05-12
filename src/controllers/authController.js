import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClerkClient, verifyToken } from '@clerk/backend';
import prisma from '../services/prisma.js';
const JWT_SECRET = process.env.JWT_SECRET;

export const register = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // 1. Verificar si el usuario ya existe
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario ya existe con este correo.' });
        }

        // 2. Encriptar la contraseña
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // 3. Guardar el usuario en la base de datos
        const newUser = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name
            }
        });

        // 4. Generar el token (JWT) para iniciar sesión automáticamente
        const token = jwt.sign({ userId: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ message: 'Usuario creado exitosamente', token, user: { name: newUser.name, email: newUser.email } });
    } catch (error) {
        console.error('Error en register:', error);
        res.status(500).json({ error: 'Error interno del servidor al registrar el usuario.' });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Buscar al usuario por correo
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'Credenciales inválidas.' });

        // 2. Comparar la contraseña enviada con la encriptada en la BD
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(401).json({ error: 'Credenciales inválidas.' });

        // 3. Generar el token (JWT)
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ message: 'Login exitoso', token, user: {name: user.name, email: user.email} });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno al iniciar sesión.' });
    }
};

export const syncUser = async (req, res) => {
    try {
        // --- INICIO: Bloque de depuración ---
        console.log('--- Nueva petición a /sync ---');
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        // --- FIN: Bloque de depuración ---

        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token de Clerk no proporcionado.' });
        }

        const clerkToken = authHeader.split(' ')[1];

        // Verificar el token de Clerk y obtener el payload
        let payload;
        try {
            payload = await verifyToken(clerkToken, {
                jwtKey: process.env.CLERK_JWT_KEY,
            });
        } catch (err) {
            console.error("Error al verificar token de Clerk:", err);
            return res.status(403).json({ error: 'Token de Clerk inválido o expirado.' });
        }

        // --- INICIO: Bloque de depuración ---
        console.log('Payload del token de Clerk verificado:', JSON.stringify(payload, null, 2));
        // --- FIN: Bloque de depuración ---

        // 1. Extraer el clerkId del token (Esto es 100% seguro y garantizado)
        const clerkId = payload.sub;

        // 2. Usar el clerkId para obtener los datos completos y actualizados del usuario desde la API de Clerk.
        // Esto es más robusto que depender de los datos en el payload del token.
        const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
        const clerkUser = await clerkClient.users.getUser(clerkId);

        // --- INICIO: Bloque de depuración ---
        console.log('Objeto de usuario de Clerk API:', JSON.stringify(clerkUser, null, 2));
        // --- FIN: Bloque de depuración ---

        // Extraer los datos del objeto de usuario de Clerk
        const email = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;
        // Lógica mejorada para obtener el nombre:
        // 1. Intenta usar el nombre completo (fullName).
        // 2. Si no existe, combina nombre (firstName) y apellido (lastName).
        // 3. Si tampoco existen, usa el nombre de usuario (username) como último recurso.
        const name = clerkUser.fullName || `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username;
        const profilePicUrl = clerkUser.imageUrl;

        if (!email) {
            return res.status(400).json({ error: 'El correo no fue proporcionado por el proveedor de autenticación.' });
        }

        // Lógica de sincronización: Buscar, Vincular o Crear
        let user;
        const existingUserByClerkId = await prisma.user.findUnique({ where: { clerkId } });

        if (existingUserByClerkId) {
            // El usuario ya existe y está vinculado. Actualizamos sus datos por si cambiaron.
            console.log(`Usuario encontrado por clerkId: ${clerkId}. Actualizando datos.`);
            user = await prisma.user.update({
                where: { id: existingUserByClerkId.id },
                data: {
                    name: name || existingUserByClerkId.name,
                    email: email, // El email de Clerk es la fuente de verdad
                    profilePicUrl: profilePicUrl || existingUserByClerkId.profilePicUrl,
                },
            });
        } else {
            // No se encontró por clerkId, buscamos por email para vincular una cuenta existente.
            const existingUserByEmail = await prisma.user.findUnique({ where: { email } });

            if (existingUserByEmail) {
                // El usuario ya existía (ej. registro tradicional), lo vinculamos a su Clerk ID.
                console.log(`Usuario encontrado por email: ${email}. Vinculando con clerkId: ${clerkId}.`);
                user = await prisma.user.update({
                    where: { id: existingUserByEmail.id },
                    data: { 
                        clerkId,
                        name: name || existingUserByEmail.name,
                        profilePicUrl: profilePicUrl || existingUserByEmail.profilePicUrl
                    },
                });
            } else {
                // El usuario es completamente nuevo. Lo creamos.
                console.log(`Creando nuevo usuario para email: ${email} y clerkId: ${clerkId}.`);
                user = await prisma.user.create({
                    data: {
                        clerkId,
                        email,
                        name: name || null,
                        profilePicUrl: profilePicUrl || null,
                    },
                });
            }
        }

        // Generar el token JWT de NUESTRO backend
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        // Responder al frontend con la estructura exacta que espera
        res.status(200).json({
            token: token,
            user: {
                name: user.name,
                email: user.email,
                profilePicUrl: user.profilePicUrl,
            }
        });
    } catch (error) {
        console.error('Error en syncUser:', error);
        res.status(500).json({ error: 'Error interno al sincronizar usuario.' });
    }
};
