import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import path from 'path';

const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL; // Dominio personalizado o R2.dev

// Cloudflare R2 es compatible con la API de S3 de AWS
const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
});

export const uploadFileToR2 = async (file) => {
    // Generamos un nombre único para evitar colisiones
    const fileExtension = path.extname(file.originalname);
    const randomName = crypto.randomBytes(16).toString('hex') + fileExtension;
    const key = `flows/${Date.now()}-${randomName}`; // Guardado en carpeta /flows

    // Configuramos el comando de subida
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,          // Sacamos el buffer directamente de la RAM
        ContentType: file.mimetype, // Ej: image/png, image/jpeg
    });

    await s3Client.send(command);

    // Retornamos la URL pública para que la guardes en tu Prisma/Base de datos
    return `${publicUrl}/${key}`;
};