-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PATIENT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "patient_profiles" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "dateOfBirth" DATETIME,
    "sex" TEXT,
    "heightCm" REAL,
    "weightKg" REAL,
    "ckdStage" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "dialysisType" TEXT NOT NULL DEFAULT 'NONE',
    "dailySodiumLimitMg" INTEGER,
    "dailyPotassiumLimitMg" INTEGER,
    "dailyPhosphorusLimitMg" INTEGER,
    "dailyProteinLimitG" INTEGER,
    "dailyFluidLimitMl" INTEGER,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "patient_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meal_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_POST_PHOTO',
    "preMealAt" DATETIME NOT NULL,
    "postMealAt" DATETIME,
    "mealDurationSeconds" INTEGER,
    "notes" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meal_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mealRecordId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTimezoneOffsetMin" INTEGER,
    "capturedOffline" BOOLEAN NOT NULL DEFAULT false,
    "clientClockSkewSeconds" INTEGER,
    "deviceUserAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "photos_mealRecordId_fkey" FOREIGN KEY ("mealRecordId") REFERENCES "meal_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "nutrition_estimates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "photoId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "modelName" TEXT,
    "modelVersion" TEXT,
    "sodiumMg" REAL,
    "potassiumMg" REAL,
    "phosphorusMg" REAL,
    "proteinG" REAL,
    "calorieKcal" REAL,
    "confidenceScore" REAL,
    "rawModelOutput" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "nutrition_estimates_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "photos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "points_ledger_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "mealRecordId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "points_ledger_entries_mealRecordId_fkey" FOREIGN KEY ("mealRecordId") REFERENCES "meal_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_streaks" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "currentStreakDays" INTEGER NOT NULL DEFAULT 0,
    "longestStreakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconEmoji" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "earnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mealRecordId" TEXT,
    CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "badges" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_badges_mealRecordId_fkey" FOREIGN KEY ("mealRecordId") REFERENCES "meal_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SELF_SERVICE',
    "issuedById" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "password_reset_tokens_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "meal_records_userId_preMealAt_idx" ON "meal_records"("userId", "preMealAt");

-- CreateIndex
CREATE UNIQUE INDEX "photos_storageKey_key" ON "photos"("storageKey");

-- CreateIndex
CREATE INDEX "photos_mealRecordId_idx" ON "photos"("mealRecordId");

-- CreateIndex
CREATE INDEX "photos_userId_capturedAt_idx" ON "photos"("userId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "photos_mealRecordId_phase_key" ON "photos"("mealRecordId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_estimates_photoId_key" ON "nutrition_estimates"("photoId");

-- CreateIndex
CREATE INDEX "points_ledger_entries_userId_createdAt_idx" ON "points_ledger_entries"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "badges_code_key" ON "badges"("code");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeId_key" ON "user_badges"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_codeHash_key" ON "password_reset_tokens"("codeHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");
