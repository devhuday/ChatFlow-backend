import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export const verifyToken = (req, res, next) => {
    // El token normalmente se envía en el header "Authorization: Bearer <token>"
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Guardamos los datos del usuario (userId, email) en la request
        next(); // Continuamos a la ruta protegida
    } catch (error) {
        return res.status(403).json({ error: 'Token inválido o expirado.' });
    }
};