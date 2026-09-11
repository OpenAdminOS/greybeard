#import <Cocoa/Cocoa.h>
#include <sys/mount.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {
  @autoreleasepool {
    NSString *bundle = [[NSBundle mainBundle] bundlePath];
    struct statfs filesystem;
    if (statfs([bundle fileSystemRepresentation], &filesystem) != 0) {
      perror("Cannot inspect Greybeard installation");
      return 1;
    }
    if (filesystem.f_flags & MNT_RDONLY) {
      fprintf(stderr, "Install Greybeard first: drag Greybeard.app to Applications, then open the installed app.\n");
      if (argc == 1) {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [NSApp activateIgnoringOtherApps:YES];
        NSAlert *alert = [[NSAlert alloc] init];
        [alert setMessageText:@"Install Greybeard first"];
        [alert setInformativeText:@"Drag Greybeard to Applications, then open Greybeard from Applications. You can eject this disk image afterwards."];
        [alert addButtonWithTitle:@"OK"];
        [alert runModal];
      }
      return 78;
    }
    NSString *core = [bundle stringByAppendingPathComponent:@"Contents/MacOS/greybeard"];
    char **arguments = calloc((size_t)argc + 1, sizeof(char *));
    if (!arguments) return 1;
    arguments[0] = (char *)[core fileSystemRepresentation];
    for (int index = 1; index < argc; index++) arguments[index] = argv[index];
    execv(arguments[0], arguments);
    perror("Cannot start Greybeard");
    free(arguments);
    return 1;
  }
}
