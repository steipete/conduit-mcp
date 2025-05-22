# conduit-mcp 🐱

![conduit-mcp logo](assets/logo.png)

![conduit-mcp banner](assets/banner.png)

**The purr-fect MCP server for feline-fast file operations, web prowling, and data hunting! 🐾**

*A sleek Model Context Protocol server that helps your AI assistant navigate the digital jungle with cat-like agility.*

## 🐈 What Makes This Cat Special?

`conduit-mcp` is like having a highly trained data-hunting cat that can:
- 🏠 **Patrol your file system** (within allowed territories, of course!)
- 🌐 **Hunt across the web** for tasty content morsels  
- 📄 **Clean up messy HTML** into pristine Markdown
- 🖼️ **Compress images** without losing their shine
- 📁 **Organize files** with military precision
- 🔍 **Track down specific files** using advanced search techniques
- 📦 **Pack and unpack archives** like a pro moving service

Unlike those lazy house cats, this server works 24/7 and never knocks things off your desk! 😸

## 🎯 Quick Start (Get Your Cat Running!)

### Method 1: The Easy Way (Recommended)
Just tell your MCP client about your new digital pet:

```json
{
  "mcpServers": {
    "conduit_mcp": {
      "command": "npx",
      "args": ["-y", "conduit-mcp@latest"],
      "env": {
        "CONDUIT_ALLOWED_PATHS": "~/Documents:~/Projects",
        "LOG_LEVEL": "INFO"
      }
    }
  }
}
```

### Method 2: The Developer Way (For Cat Breeders)
```bash
git clone <repository_url>
cd conduit-mcp
npm install
# Configure your MCP client to use ./start.sh
```

## 🏠 Setting Up Your Cat's Territory

Your digital cat needs to know where it's allowed to roam! Configure the `CONDUIT_ALLOWED_PATHS` environment variable:

```bash
# Let your cat explore Documents and Projects
CONDUIT_ALLOWED_PATHS="~/Documents:~/Projects"

# Default playground (if you don't specify)
# Your cat defaults to: "~:/tmp" 
# (Don't worry, it'll meow about this the first time!)
```

**🚨 Security Notice:** Your cat is well-trained and won't venture outside its allowed territories. It also follows all symlinks to ensure no sneaky escapes!

## 🐾 What Your Cat Can Do

### 🔍 The `read` Tool - Master Detective Cat

Your cat can investigate files and URLs with four different specialties:

#### Content Reading (`operation: "content"`)
```json
{
  "tool": "read",
  "operation": "content",
  "sources": ["~/Documents/important.txt", "https://example.com/article"],
  "format": "text"
}
```

**Format Options:**
- `"text"` - Read as plain text (default for text files)
- `"base64"` - Binary-safe encoding (default for images/binaries)
- `"markdown"` - Web pages get the full spa treatment! 🧖‍♀️
- `"checksum"` - Generate cryptographic fingerprints

**Special Powers:**
- 🌐 **Web Page Cleaning**: Turns messy HTML into beautiful Markdown
- 🖼️ **Smart Image Compression**: Automatically compresses large images
- 📐 **Partial Reading**: Read specific byte ranges with `offset` and `length`
- 🔒 **Checksum Calculation**: SHA256, MD5, SHA1, or SHA512

#### Metadata Inspection (`operation: "metadata"`)
```json
{
  "tool": "read", 
  "operation": "metadata",
  "sources": ["~/Documents/mystery_file.pdf"]
}
```

Gets you the full dossier: size, type, timestamps, permissions, and more!

#### File Comparison (`operation: "diff"`)
```json
{
  "tool": "read",
  "operation": "diff", 
  "sources": ["~/file1.txt", "~/file2.txt"]
}
```

Shows exactly what changed between two files - perfect for code reviews!

### ✏️ The `write` Tool - Master Builder Cat

Your cat can modify the file system with surgical precision:

#### File Operations
```json
{
  "tool": "write",
  "action": "put",
  "entries": [{
    "path": "~/Documents/new_file.txt",
    "content": "Hello from your digital cat! 🐱",
    "write_mode": "overwrite"
  }]
}
```

**Available Actions:**
- `"put"` - Write files (text or base64)
- `"mkdir"` - Create directories (with `recursive` option)
- `"copy"` - Duplicate files/folders
- `"move"` - Relocate and rename
- `"delete"` - Remove files/folders (with `recursive` for directories)
- `"touch"` - Update timestamps or create empty files

#### Archive Operations
```json
{
  "tool": "write",
  "action": "archive",
  "source_paths": ["~/Documents/folder1", "~/Documents/file1.txt"],
  "archive_path": "~/backup.zip",
  "format": "zip"
}
```

**Archive Formats:** ZIP, TAR.GZ, TGZ - your cat handles them all!

### 📋 The `list` Tool - Inventory Cat

#### Directory Listing
```json
{
  "tool": "list",
  "operation": "entries",
  "path": "~/Documents",
  "recursive_depth": 2,
  "calculate_recursive_size": true
}
```

**Special Features:**
- 🌳 **Recursive Exploration**: Dive deep into folder structures
- 📊 **Size Calculation**: Get total size of directories
- 🔗 **Symlink Detection**: Identifies and follows symbolic links
- ⏱️ **Smart Timeouts**: Won't get stuck calculating huge directories

#### System Information
```json
{
  "tool": "list",
  "operation": "system_info",
  "info_type": "server_capabilities"
}
```

Learn about your cat's capabilities and current configuration!

### 🔎 The `find` Tool - Bloodhound Cat

The most sophisticated search tool - your cat can find ANYTHING:

#### Name-Based Search
```json
{
  "tool": "find",
  "base_path": "~/Documents",
  "match_criteria": [{
    "type": "name_pattern",
    "pattern": "*.{pdf,doc,docx}"
  }]
}
```

#### Content Search
```json
{
  "tool": "find",
  "base_path": "~/Projects",
  "match_criteria": [{
    "type": "content_pattern", 
    "pattern": "TODO|FIXME",
    "is_regex": true,
    "case_sensitive": false
  }]
}
```

#### Metadata Filtering
```json
{
  "tool": "find",
  "base_path": "~/Documents",
  "match_criteria": [{
    "type": "metadata_filter",
    "attribute": "size_bytes", 
    "operator": "gt",
    "value": 1048576
  }]
}
```

**Search Superpowers:**
- 🎯 **Multi-criteria AND logic**: All criteria must match
- 🔤 **Glob patterns**: `*.txt`, `image[0-9]?.png`, `**/logs/*.log`
- 📝 **Content search**: Text or regex patterns in file contents
- 📅 **Date filtering**: Find files by creation/modification dates
- 📏 **Size filtering**: Find large files, empty files, etc.
- 🎭 **MIME type filtering**: Search by file type

## 🎛️ Configuring Your Cat

Your digital cat responds to these environment variables:

### Core Settings
```bash
# Territory boundaries (IMPORTANT!)
CONDUIT_ALLOWED_PATHS="~/Documents:~/Projects:/tmp"

# Logging (where your cat writes its diary)
LOG_LEVEL="INFO"  # TRACE, DEBUG, INFO, WARN, ERROR, FATAL
CONDUIT_LOG_FILE_PATH="/tmp/conduit-mcp.log"  # or "NONE" to disable
```

### Performance Tuning
```bash
# Resource limits (keep your cat well-behaved)
CONDUIT_MAX_FILE_READ_BYTES="52428800"      # 50MB max file reads
CONDUIT_MAX_URL_DOWNLOAD_BYTES="20971520"   # 20MB max downloads
CONDUIT_HTTP_TIMEOUT_MS="30000"             # 30 second timeouts

# Image compression (make photos diet-friendly)
CONDUIT_IMAGE_COMPRESSION_THRESHOLD_BYTES="1048576"  # 1MB threshold
CONDUIT_IMAGE_COMPRESSION_QUALITY="75"               # Quality 1-100
```

### Advanced Settings
```bash
# Search and recursion limits
CONDUIT_MAX_RECURSIVE_DEPTH="10"           # How deep to explore
CONDUIT_RECURSIVE_SIZE_TIMEOUT_MS="60000"  # 60 second timeout

# Default checksum algorithm
CONDUIT_DEFAULT_CHECKSUM_ALGORITHM="sha256"  # md5, sha1, sha256, sha512
```

## 🎉 Special Features That Make This Cat Purr

### 🌐 Web Content Cleaning
When you ask for Markdown from a URL, your cat:
1. Fetches the raw HTML
2. Uses Mozilla Readability to extract main content
3. Converts to clean Markdown with Turndown
4. Serves you a beautifully formatted result!

For non-HTML content, it gracefully falls back to raw text with helpful notes.

### 🖼️ Intelligent Image Compression  
Large images automatically get compressed using Sharp:
- JPEG/WebP: Quality-based compression
- PNG: Lossless optimization
- Preserves original size information
- Graceful fallback if compression fails

### 🔒 Security Features
Your cat is security-conscious:
- **Path validation**: Never ventures outside allowed territories
- **Symlink resolution**: Follows links but validates final destinations  
- **Resource limits**: Won't eat all your memory or bandwidth
- **Input sanitization**: Properly validates all parameters

### 📋 Batch Operations
Efficiency expert! Process multiple files in a single request:
```json
{
  "tool": "write",
  "action": "copy", 
  "entries": [
    {"source_path": "~/file1.txt", "destination_path": "~/backup/"},
    {"source_path": "~/file2.txt", "destination_path": "~/backup/"},
    {"source_path": "~/folder1", "destination_path": "~/backup/"}
  ]
}
```

### 🔄 First-Time Setup Notice
When using default paths (`~:/tmp`), your cat will politely inform you on the first successful operation with details about the configuration. It's like a friendly meow saying "Hi! Here's where I'm allowed to play!"

## 🚨 Error Handling

Your cat is well-mannered and provides detailed error information:

```json
{
  "status": "error",
  "error_code": "ERR_FS_ACCESS_DENIED", 
  "error_message": "Cannot access path outside allowed directories: /forbidden/path"
}
```

**Common Error Categories:**
- `ERR_FS_*` - File system issues
- `ERR_HTTP_*` - Web request problems  
- `ERR_INVALID_PARAMETER` - Bad input data
- `ERR_RESOURCE_LIMIT_EXCEEDED` - Size/timeout limits hit
- `ERR_ARCHIVE_*` - Archive operation failures

## 🛠️ Development & Testing

### Running Tests
```bash
npm test                # Run all tests
npm run test:coverage   # With coverage report
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests
```

### Building
```bash
npm run build          # Compile TypeScript
npm run dev            # Development mode with auto-reload
npm run lint           # Check code style
npm run format         # Auto-format code
```

## 🤝 Contributing

We love contributions! Please:
1. 🍴 Fork the repository
2. 🌿 Create a feature branch (`git checkout -b feature/amazing-cat-feature`)
3. 🐾 Make your changes (follow the existing code style)
4. ✅ Add tests for new functionality
5. 📝 Update documentation if needed
6. 🚀 Submit a pull request

### Commit Convention
We use conventional commits:
```
feat: add new search criteria type
fix: resolve symlink resolution bug  
docs: update README with new examples
test: add integration tests for archive operations
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐱 Fun Facts About Your Digital Cat

- **Line Count**: ~14,000 lines of carefully crafted TypeScript
- **Dependencies**: Only the finest NPM packages (axios, sharp, jsdom, etc.)
- **Test Coverage**: >90% (this cat is thoroughly tested!)
- **Protocols**: 100% MCP compliant
- **Character Encoding**: UTF-8 all the way
- **Timestamp Format**: ISO 8601 UTC (because cats are international)

## 🎯 Use Cases

Perfect for AI assistants that need to:
- 📊 **Analyze local codebases** and documentation
- 🌐 **Research web content** and convert to readable formats
- 🔄 **Manage file organization** and backups
- 🔍 **Search across mixed content types**
- 📸 **Process and optimize images**
- 📦 **Handle archive operations**
- 📈 **Generate reports** from filesystem data

## 🆘 Support & Community

- 📚 **Documentation**: You're reading it! (Plus the technical spec)
- 🐛 **Issues**: GitHub Issues for bugs and feature requests
- 💬 **Discussions**: GitHub Discussions for questions and ideas  
- 📧 **Contact**: Open source project - community driven!

---

**Happy hunting! 🐾** 

*Your digital cat is ready to pounce on any data challenge you throw at it!*