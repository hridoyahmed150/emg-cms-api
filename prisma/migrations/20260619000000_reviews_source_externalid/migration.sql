-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateIndex
CREATE UNIQUE INDEX "Review_organizationId_externalId_key" ON "Review"("organizationId", "externalId");
