---
name: File Operations
description: How to read, write, and manage files
triggers: file,create,write,read,save,edit,folder,directory
---

# File Operations

Use these workflows for file management tasks.

## Read a File

```
read_file {"path": "C:\\Users\\Username\\Desktop\\file.txt"}
```

## Write a File

```
write_file {"path": "C:\\Users\\Username\\Desktop\\file.txt", "content": "Hello World"}
```

## List Directory Contents

```powershell
tool_code Get-ChildItem "$env:USERPROFILE\Desktop"
```

## Create a Folder

```powershell
tool_code New-Item -ItemType Directory -Path "$env:USERPROFILE\Desktop\NewFolder"
```

## Copy a File

```powershell
tool_code Copy-Item "source.txt" -Destination "dest.txt"
```

## Move/Rename a File

```powershell
tool_code Move-Item "oldname.txt" -Destination "newname.txt"
```

## Delete a File (use with caution)

```powershell
tool_code Remove-Item "file.txt"
```

## Tips

- Always use full paths when possible
- Use `$env:USERPROFILE` for the user's home directory
- Use `$env:USERPROFILE\Desktop` for the Desktop
- Escape backslashes in JSON: `\\` instead of `\`
