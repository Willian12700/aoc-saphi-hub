const net = require('net');

class TwitchChatService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.currentChannel = null;
    this.messages = [];
    this.maxMessages = 25;
    this.lastAccessTime = Date.now();
  }

  ensureConnection(channel) {
    const cleanChan = (channel || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanChan) return;

    this.lastAccessTime = Date.now();

    if (!this.client || !this.connected) {
      this.connect(cleanChan);
      return;
    }

    if (this.currentChannel !== cleanChan) {
      if (this.currentChannel) {
        try { this.client.write(`PART #${this.currentChannel}\r\n`); } catch (e) {}
      }
      this.currentChannel = cleanChan;
      this.messages = [];
      try { this.client.write(`JOIN #${cleanChan}\r\n`); } catch (e) {}
    }
  }

  connect(initialChannel) {
    if (this.client) {
      try { this.client.destroy(); } catch (e) {}
    }

    this.currentChannel = initialChannel;
    this.messages = [];

    const nick = 'justinfan' + Math.floor(10000 + Math.random() * 89999);
    const client = net.createConnection(6667, 'irc.chat.twitch.tv', () => {
      this.connected = true;
      client.write('CAP REQ :twitch.tv/tags\r\n');
      client.write(`NICK ${nick}\r\n`);
      client.write(`USER ${nick} 8 * :${nick}\r\n`);
      if (this.currentChannel) {
        client.write(`JOIN #${this.currentChannel}\r\n`);
      }
    });

    let buffer = '';
    client.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n');
      buffer = lines.pop(); // keep last incomplete line

      for (const line of lines) {
        if (line.startsWith('PING')) {
          client.write('PONG :tmi.twitch.tv\r\n');
          continue;
        }

        if (line.includes('PRIVMSG')) {
          this.parseMessage(line);
        }
      }
    });

    client.on('error', err => {
      console.log('[CHAT-IRC] Error:', err.message);
      this.connected = false;
    });

    client.on('close', () => {
      this.connected = false;
    });

    this.client = client;
  }

  parseMessage(raw) {
    try {
      // Tags format: @badge-info=...;color=#HEX;display-name=Name;... :user!user@user.tmi.twitch.tv PRIVMSG #chan :msg
      let tags = {};
      let rest = raw;

      if (raw.startsWith('@')) {
        const spaceIdx = raw.indexOf(' ');
        const tagsStr = raw.slice(1, spaceIdx);
        rest = raw.slice(spaceIdx + 1);

        for (const pair of tagsStr.split(';')) {
          const eq = pair.indexOf('=');
          if (eq > 0) {
            tags[pair.slice(0, eq)] = pair.slice(eq + 1);
          }
        }
      }

      const privIdx = rest.indexOf('PRIVMSG');
      if (privIdx === -1) return;

      const afterPriv = rest.slice(privIdx);
      const colonIdx = afterPriv.indexOf(' :');
      if (colonIdx === -1) return;

      const msgText = afterPriv.slice(colonIdx + 2).trim();
      const user = tags['display-name'] || (rest.match(/:([^!]+)!/)?.[1]) || 'Chatter';
      const color = tags['color'] || '#9146FF';

      if (!msgText) return;

      this.messages.push({
        id: Date.now() + Math.random(),
        user: user.slice(0, 16),
        color: color.startsWith('#') ? color : '#9146FF',
        text: msgText.slice(0, 120),
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      });

      if (this.messages.length > this.maxMessages) {
        this.messages.shift();
      }
    } catch (e) {}
  }

  getMessages(channel) {
    this.ensureConnection(channel);
    return this.messages;
  }
}

const chatInstance = new TwitchChatService();

module.exports = {
  chatService: chatInstance
};
