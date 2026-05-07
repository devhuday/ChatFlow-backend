-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotConfig" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "useAI" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiPrompt" TEXT,
    "responseTree" JSONB,

    CONSTRAINT "BotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message_History" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_History_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotConfig_sessionId_key" ON "BotConfig"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_sessionId_customerPhone_key" ON "Chat"("sessionId", "customerPhone");

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message_History" ADD CONSTRAINT "Message_History_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
