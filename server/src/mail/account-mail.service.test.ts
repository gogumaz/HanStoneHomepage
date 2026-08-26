import type { Transporter } from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMailService } from "./account-mail.service.js";

describe("AccountMailService", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    process.env.CORS_ORIGINS = "http://127.0.0.1:5173";
    process.env.PUBLIC_APP_URL = "https://learn.example.com";
    process.env.MAIL_FROM = "바둑타고 <no-reply@example.com>";
    delete process.env.SMTP_HOST;
  });

  it("sends an escaped single-use email verification link", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "message-verification" }));
    const service = new AccountMailService({ sendMail } as unknown as Transporter);
    const token = "v".repeat(43);

    await expect(service.sendEmailVerification({
      email: "member@example.com",
      displayName: "<한별>",
      token,
    })).resolves.toEqual({ status: "sent", messageId: "message-verification" });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "바둑타고 <no-reply@example.com>",
      to: "member@example.com",
      subject: "[바둑타고] 이메일을 인증해 주세요",
      text: expect.stringContaining(`https://learn.example.com/account?verifyEmailToken=${token}`),
      html: expect.stringContaining("&lt;한별&gt;"),
    }));
  });

  it("sends a password reset link without exposing the token outside the message", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "message-reset" }));
    const service = new AccountMailService({ sendMail } as unknown as Transporter);
    const token = "r".repeat(43);

    await expect(service.sendPasswordReset({
      email: "member@example.com",
      displayName: "복구 회원",
      token,
    })).resolves.toEqual({ status: "sent", messageId: "message-reset" });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "member@example.com",
      subject: "[바둑타고] 비밀번호를 다시 설정해 주세요",
      text: expect.stringContaining(`https://learn.example.com/account?resetToken=${token}`),
    }));
  });

  it("skips delivery outside production when SMTP is not configured", async () => {
    delete process.env.MAIL_FROM;
    const service = new AccountMailService();

    await expect(service.sendPasswordReset({
      email: "member@example.com",
      displayName: "복구 회원",
      token: "r".repeat(43),
    })).resolves.toEqual({ status: "skipped" });
  });

  it("notifies a member without copying private inquiry content into the message", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "message-inquiry" }));
    const service = new AccountMailService({ sendMail } as unknown as Transporter);

    await expect(service.sendInquiryAnswered({
      email: "member@example.com",
      displayName: "<문의 회원>",
      inquiryId: "00000000-0000-0000-0000-000000000501",
    })).resolves.toEqual({ status: "sent", messageId: "message-inquiry" });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "member@example.com",
      subject: "[바둑타고] 1:1 문의에 답변이 등록되었습니다",
      text: expect.stringContaining("https://learn.example.com/board.html?type=inquiry&id=00000000-0000-0000-0000-000000000501"),
      html: expect.stringContaining("&lt;문의 회원&gt;"),
    }));
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain("문의 본문 비밀값");
  });

  it("verifies SMTP connectivity without sending a message", async () => {
    const verify = vi.fn(async () => true);
    const sendMail = vi.fn();
    const service = new AccountMailService({ verify, sendMail } as unknown as Transporter);

    await expect(service.verifyConnection()).resolves.toBeUndefined();

    expect(verify).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
