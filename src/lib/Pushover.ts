import got, { Got } from 'got';
import FormData from 'form-data';
import * as fs from 'fs';

const PUSHOVER_ENDPOINT = 'https://api.pushover.net/1/messages.json';
export class Pushover {
  client: Got;
  constructor(private token: string, private user: string) {
    this.client = got.extend({
      responseType: 'json',
      resolveBodyOnly: true
    });
  }

  async sendMessage(message: PushoverMessage): Promise<PushoverResponse> {
    const form = new FormData();
    if (message.attachment) {
      form.append('attachment', fs.createReadStream(message.attachment));
      delete message.attachment;
    }
    form.append('token', this.token);
    form.append('user', this.user);
    for (const [key, value] of Object.entries(message)) {
      form.append(key, value);
    }
    return this.client.post(PUSHOVER_ENDPOINT, { body: form }).json<PushoverResponse>();
  }
}

export interface PushoverMessage {
  message:  string;
  title?:    string;
  sound?:    string;
  device?:   string;
  priority?: number;
  url?: string;
  url_title?: string;
  attachment?: string;
  timestamp?: string;
}

export interface PushoverResponse {
  status: number;
  request: string;
}
