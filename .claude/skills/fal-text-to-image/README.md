# fal.ai Text-to-Image Generation Skill

Professional-grade image generation from text prompts using fal.ai's state-of-the-art models.

## Quick Start

```bash
# Basic usage (auto-selects best model)
uv run python fal-text-to-image "A serene mountain landscape at sunset"

# With specific model
uv run python fal-text-to-image -m flux-pro/v1.1-ultra "Professional portrait"

# With style reference
uv run python fal-text-to-image -i reference.jpg "Artistic landscape"
```

## Setup

1. Get your API key from [fal.ai dashboard](https://fal.ai/dashboard/keys)

2. Set environment variable:
```bash
export FAL_KEY="your-api-key-here"
```

Or create `.env` file:
```env
FAL_KEY=your-api-key-here
```

3. Run (uv handles dependencies automatically):
```bash
uv run python fal-text-to-image "Your prompt here"
```

## Features

- **Intelligent Model Selection**: Auto-selects best model based on prompt analysis
- **13+ Model Options**: FLUX, Recraft V3, Imagen4, Stable Diffusion, and more
- **Style Transfer**: Use reference images with `-i` flag
- **High-Resolution**: Up to 2K outputs with flux-pro/v1.1-ultra
- **Metadata Embedding**: Stores prompt and generation parameters in image EXIF
- **Reproducible**: Use `--seed` for consistent results

## Available Models

See [SKILL.md](SKILL.md) for complete model documentation.

### Top Picks

- **flux-pro/v1.1-ultra**: Professional high-res (up to 2K)
- **recraft/v3/text-to-image**: SOTA quality, excellent typography
- **flux-2**: Best balance (100 free requests)
- **ideogram/v2**: Typography specialist
- **flux-2/lora/edit**: Style transfer and editing

## Usage Examples

### Typography & Logos
```bash
uv run python fal-text-to-image \
  -m recraft/v3/text-to-image \
  "Modern tech logo with text 'AI Labs' in minimalist blue design"
```

### Professional Photography
```bash
uv run python fal-text-to-image \
  -m flux-pro/v1.1-ultra \
  "Professional headshot of business executive, studio lighting, grey background"
```

### Style Transfer
```bash
uv run python fal-text-to-image \
  -m flux-2/lora/edit \
  -i artistic_reference.jpg \
  "Portrait of a woman in a garden"
```

### Reproducible Generation
```bash
uv run python fal-text-to-image \
  -m flux-2 \
  --seed 42 \
  --steps 50 \
  "Cyberpunk cityscape with neon lights"
```

## Command-Line Options

```
Arguments:
  PROMPT                    Text description of image

Options:
  -m, --model TEXT         Model selection
  -i, --image TEXT         Reference image for style transfer
  -o, --output TEXT        Output filename
  -s, --size TEXT          Image size (1024x1024, landscape_16_9, etc.)
  --seed INTEGER           Random seed
  --steps INTEGER          Inference steps
  --guidance FLOAT         Guidance scale
  --help                   Show help
```

## Output

Images are saved to `outputs/` directory with:
- Timestamp in filename
- Model name in filename
- Embedded metadata (prompt, model, parameters)
- Console display of generation time and image URL

## Cost Management

- **Free Tier**: flux-2 offers 100 free requests (until Dec 25, 2025)
- **Budget**: Use flux-2 or stable-diffusion-v35-large
- **Premium**: flux-pro/v1.1-ultra charged per megapixel
- **Design**: recraft/v3 at $0.04/image ($0.08 for vector)

## Advanced Features

### Intelligent Model Selection

The script analyzes your prompt to select the optimal model:

- **Typography keywords** (logo, text, poster) → Recraft V3
- **High-res keywords** (professional, portrait) → FLUX Pro
- **Reference image provided** → FLUX LoRA Edit
- **Artistic keywords** → Stable Diffusion v3.5
- **Default** → FLUX 2 (balanced)

### Size Options

```bash
# Fixed dimensions
-s 1024x1024
-s 2048x1536

# Named aspect ratios (model-dependent)
-s landscape_16_9
-s portrait_9_16
-s square
```

## File Structure

```
fal-text-to-image/
├── SKILL.md                    # Full documentation
├── README.md                   # This file
├── fal-text-to-image           # Main script
├── pyproject.toml              # Dependencies
├── .env.example                # Environment template
├── .gitignore
├── references/
│   └── model-comparison.md     # Detailed model comparison
└── outputs/                    # Generated images (created on first run)
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `FAL_KEY not set` | Export FAL_KEY or create .env file |
| `Model not found` | Check model name in SKILL.md |
| `Image reference fails` | Verify file path or URL is accessible |
| `Generation timeout` | Try faster model or wait longer |

## Resources

- [fal.ai Documentation](https://docs.fal.ai/)
- [Model Playground](https://fal.ai/explore/search)
- [API Keys](https://fal.ai/dashboard/keys)
- [Pricing](https://fal.ai/pricing)

## Dependencies

Managed automatically by `uv`:
- fal-client
- python-dotenv
- pillow
- click
- requests

## License

This skill is part of the Claude Code skills ecosystem.
