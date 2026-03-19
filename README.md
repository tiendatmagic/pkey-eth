# PKey ETH - Vanity Ethereum Address Generator

A high-performance, **100% client-side** Ethereum vanity address generator built with Next.js, TypeScript, and Tailwind CSS. Generate customized Ethereum addresses securely within your browser using multi-core CPU acceleration.

## Features

- **High Speed**: Utilizes **Web Workers** for multi-threaded parallel generation, maximizing your CPU's performance.
- **Privacy First**: All cryptographic operations (`secp256k1`, `keccak256`) happen entirely in your browser. No data ever leaves your machine.
- **Secure Export**: Generate and download encrypted **Keystore files (UTC / JSON)** to safely import your new wallet into MetaMask and other clients.
- **i18n Support**: Full support for **English** and **Vietnamese (Tiếng Việt)** with persistent language settings.
- **Smart UI**: Modern, responsive dashboard with Dark/Light mode support, dynamic probability calculations, and real-time generation stats.
- **Input Validation**: Strictly enforced hexadecimal filtering and combined length constraints to ensure generated addresses follow Ethereum specifications.

## Tech Stack

- **Framework**: [Next.js 16+](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Typography**: [Open Sans](https://fonts.google.com/specimen/Open+Sans) & [Roboto Mono](https://fonts.google.com/specimen/Roboto+Mono)
- **Crypto Libraries**:
  - `ethers.js` (for Keystore encryption)
  - `noble-secp256k1` (for high-speed EC math)
  - `js-sha3` (Keccak-256)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v24 or later)
- npm, yarn, pnpm, or bun

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/tiendatmagic/pkey-eth.git
   cd pkey-eth
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Production Build

To build for production:

```bash
npm run build
```

The optimized output will be in the `.next` folder, ready for deployment on Vercel, Netlify, or as a static site.

## Security

This tool is designed to be used safely:
- **Offline Capable**: You can download/clone the repo and run it entirely without an internet connection for absolute security.
- **No Backend**: There is no server-side component. Private keys are never stored, logged, or transmitted.
- **Open Source**: Verify the code yourself and contribute to the community!

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/tiendatmagic/pkey-eth/issues).

## Support

If you found this tool useful, consider giving the repository a **Star** and sharing it with the community!

## License

Distributed under the MIT License. See `LICENSE` for more information.
