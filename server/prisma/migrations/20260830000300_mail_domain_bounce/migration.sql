ALTER TYPE "AccountMailStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "InquiryNotificationStatus" ADD VALUE 'BOUNCED';

CREATE INDEX "AccountMailJob_messageId_idx" ON "AccountMailJob"("messageId");
CREATE INDEX "InquiryNotificationJob_messageId_idx" ON "InquiryNotificationJob"("messageId");
