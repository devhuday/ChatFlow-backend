import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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