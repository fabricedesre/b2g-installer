HOSTCC=gcc

WEBCC=emcc

CFLAGS=-I. -I./libsparse/include -I./zlib

SRC = make_ext4fs_main.c       \
      make_ext4fs.c            \
      canned_fs_config.c       \
      ext4_utils.c             \
      contents.c               \
      wipe.c                   \
      libsparse/sparse.c       \
      libsparse/backed_block.c \
      libsparse/output_file.c  \
      libsparse/sparse_crc32.c \
      allocate.c               \
      uuid.c                   \
      ext4_sb.c                \
      indirect.c               \
      extent.c                 \
      crc16.c                  \
      sha1.c                   \
      zlib/src/adler32.c       \
      zlib/src/compress.c      \
      zlib/src/crc32.c         \
      zlib/src/deflate.c       \
      zlib/src/gzclose.c       \
      zlib/src/gzlib.c         \
      zlib/src/gzread.c        \
      zlib/src/gzwrite.c       \
      zlib/src/infback.c       \
      zlib/src/inffast.c       \
      zlib/src/inflate.c       \
      zlib/src/inftrees.c      \
      zlib/src/trees.c         \
      zlib/src/uncompr.c       \
      zlib/src/zutil.c         \

%.o: %.c
	$(CC) -c -o $@ $< $(CFLAGS)

web: $(SRC)
	$(WEBCC) -o make_ext4fs.js $^ $(CFLAGS)

host: $(SRC)
	$(HOSTCC) -o make_ext4fs $^ $(CFLAGS)

clean:
	rm make_ext4fs.js make_ext4fs
