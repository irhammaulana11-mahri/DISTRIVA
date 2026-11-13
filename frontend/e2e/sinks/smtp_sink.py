import asyncio, json, sys
from email import message_from_bytes
OUT = sys.argv[1]; PORT = int(sys.argv[2])

async def handle(reader, writer):
    writer.write(b"220 sink ESMTP\r\n"); await writer.drain()
    rcpt = []
    while True:
        line = await reader.readline()
        if not line: break
        cmd = line.decode(errors="replace").strip()
        up = cmd.upper()
        if up.startswith("EHLO") or up.startswith("HELO"):
            writer.write(b"250 sink\r\n")
        elif up.startswith("MAIL FROM"):
            writer.write(b"250 OK\r\n")
        elif up.startswith("RCPT TO"):
            rcpt.append(cmd.split(":", 1)[1].strip().strip("<>")); writer.write(b"250 OK\r\n")
        elif up == "DATA":
            writer.write(b"354 go ahead\r\n"); await writer.drain()
            data = b""
            while True:
                l = await reader.readline()
                if l in (b".\r\n", b""): break
                data += l
            msg = message_from_bytes(data)
            body = msg.get_payload(decode=True) if not msg.is_multipart() else msg.get_payload(0).get_payload(decode=True)
            with open(OUT, "a") as f:
                f.write(json.dumps({"to": rcpt, "subject": str(msg["Subject"]), "body": body.decode("utf-8", "replace")}) + "\n")
            rcpt = []
            writer.write(b"250 queued\r\n")
        elif up == "QUIT":
            writer.write(b"221 bye\r\n"); await writer.drain(); break
        else:
            writer.write(b"250 OK\r\n")
        await writer.drain()
    writer.close()

async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    async with server: await server.serve_forever()
asyncio.run(main())
