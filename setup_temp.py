from setuptools import find_packages, setup

with open("README.md", "r", encoding='utf-8') as f:
    long_description = f.read()

setup(
    name="bettercam",
    version="1.0.0",
    description = "A Python high-performance screenshot library for Windows use Desktop Duplication API",
    packages=find_packages(where="find:"),
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/RootKit-Org/BetterCam",
    author="Qfc9",
    author_email="eharmon@rootkit.org",
    license="MIT",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3 :: Only",
        "License :: OSI Approved :: MIT License",
        "Operating System :: Microsoft :: Windows",
        "Operating System :: Microsoft :: Windows :: Windows 8.1",
        "Operating System :: Microsoft :: Windows :: Windows 10",
        "Operating System :: Microsoft :: Windows :: Windows 11",
        "Topic :: Multimedia :: Graphics",
        "Topic :: Multimedia :: Graphics :: Capture",
        "Topic :: Multimedia :: Graphics :: Capture :: Screen Capture"
    ],
    install_requires=["numpy", "comtypes"],
    extras_require={
        "cv2": ["opencv-python"],
    },
    python_requires=">=3.8",
    include_dirs=["bettercam"],
)