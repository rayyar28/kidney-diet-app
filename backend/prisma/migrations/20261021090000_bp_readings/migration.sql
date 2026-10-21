-- CreateTable
CREATE TABLE "bp_readings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "pulse" INTEGER NOT NULL,
    "measuredAt" DATETIME NOT NULL,
    "clientTimezoneOffsetMin" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "capturedOffline" BOOLEAN NOT NULL DEFAULT false,
    "clientClockSkewSeconds" INTEGER,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "bp_readings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_photos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mealRecordId" TEXT,
    "bpReadingId" TEXT,
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
    CONSTRAINT "photos_mealRecordId_fkey" FOREIGN KEY ("mealRecordId") REFERENCES "meal_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "photos_bpReadingId_fkey" FOREIGN KEY ("bpReadingId") REFERENCES "bp_readings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_photos" ("capturedAt", "capturedOffline", "clientClockSkewSeconds", "clientTimezoneOffsetMin", "createdAt", "deviceUserAgent", "fileSizeBytes", "heightPx", "id", "mealRecordId", "mimeType", "originalFileName", "phase", "sha256Hash", "storageKey", "uploadedAt", "userId", "widthPx") SELECT "capturedAt", "capturedOffline", "clientClockSkewSeconds", "clientTimezoneOffsetMin", "createdAt", "deviceUserAgent", "fileSizeBytes", "heightPx", "id", "mealRecordId", "mimeType", "originalFileName", "phase", "sha256Hash", "storageKey", "uploadedAt", "userId", "widthPx" FROM "photos";
DROP TABLE "photos";
ALTER TABLE "new_photos" RENAME TO "photos";
CREATE UNIQUE INDEX "photos_bpReadingId_key" ON "photos"("bpReadingId");
CREATE UNIQUE INDEX "photos_storageKey_key" ON "photos"("storageKey");
CREATE INDEX "photos_mealRecordId_idx" ON "photos"("mealRecordId");
CREATE INDEX "photos_userId_capturedAt_idx" ON "photos"("userId", "capturedAt");
CREATE UNIQUE INDEX "photos_mealRecordId_phase_key" ON "photos"("mealRecordId", "phase");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "bp_readings_userId_measuredAt_idx" ON "bp_readings"("userId", "measuredAt");

