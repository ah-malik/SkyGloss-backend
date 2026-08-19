import {
  chatPreviewText,
  isAllowedChatImageFile,
  isTrustedChatImageUrl,
} from './chat-image.constants';

describe('chat image helpers', () => {
  const originalCloud = process.env.CLOUDINARY_CLOUD_NAME;

  afterEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = originalCloud;
  });

  it('accepts png/jpg/webp by mime or filename', () => {
    expect(
      isAllowedChatImageFile({ mimetype: 'image/png', originalname: 'a.bin' }),
    ).toBe(true);
    expect(
      isAllowedChatImageFile({ mimetype: '', originalname: 'photo.JPEG' }),
    ).toBe(true);
    expect(
      isAllowedChatImageFile({ mimetype: 'image/gif', originalname: 'a.gif' }),
    ).toBe(false);
  });

  it('only trusts Cloudinary chat-folder URLs', () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'dxhmopbei';
    expect(
      isTrustedChatImageUrl(
        'https://res.cloudinary.com/dxhmopbei/image/upload/v1/skygloss-chat/abc.png',
      ),
    ).toBe(true);
    expect(
      isTrustedChatImageUrl(
        'https://res.cloudinary.com/dxhmopbei/image/upload/v1/other/abc.png',
      ),
    ).toBe(false);
    expect(isTrustedChatImageUrl('https://example.com/a.png')).toBe(false);
  });

  it('builds a photo preview when there is no caption', () => {
    expect(chatPreviewText('', true)).toBe('📷 Photo');
    expect(chatPreviewText('hello', true)).toBe('hello');
    expect(chatPreviewText('hello', false)).toBe('hello');
  });
});
