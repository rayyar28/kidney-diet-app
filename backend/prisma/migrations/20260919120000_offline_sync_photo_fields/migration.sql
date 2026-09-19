-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "capturedOffline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clientClockSkewSeconds" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "photos_mealRecordId_phase_key" ON "photos"("mealRecordId", "phase");

